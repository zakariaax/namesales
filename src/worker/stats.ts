import { foldStats, statsAreStale, type CatalogStats, type StatsGroup } from "../shared/stats";
import { clearCountCache } from "./count-cache";

export interface StoredStats extends CatalogStats {
  refreshed_at: string;
  stale: boolean;
}

const ENSURE_SQL = [
  `CREATE TABLE IF NOT EXISTS sales_stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    total INTEGER NOT NULL,
    estimates INTEGER NOT NULL,
    unknown_venues INTEGER NOT NULL,
    date_min TEXT,
    date_max TEXT,
    max_id INTEGER NOT NULL,
    refreshed_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sales_stats_extension (
    extension TEXT PRIMARY KEY,
    n INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sales_stats_venue (
    venue TEXT PRIMARY KEY,
    n INTEGER NOT NULL
  )`,
];

let tablesReady = false;
let refreshInFlight: Promise<void> | null = null;

export async function metaStats(db: D1Database, refresh: boolean): Promise<StoredStats> {
  await ensureStatsTables(db);
  const existing = await readStats(db);
  if (refresh || !existing) {
    await refreshStats(db);
  }
  const stored = await readStats(db);
  const probe = await probeEdges(db);
  if (!stored) {
    return { ...foldStats([]), refreshed_at: new Date().toISOString(), stale: true };
  }
  return { ...stored, stale: statsAreStale(stored, probe) };
}

/** Exact catalog total when the summary matches the rows currently loaded. */
export async function freshCatalogTotal(
  db: D1Database,
  probe = probeEdges(db),
): Promise<number | null> {
  await ensureStatsTables(db);
  const stored = await readStats(db);
  if (!stored) return null;
  const edges = await probe;
  if (statsAreStale(stored, edges)) return null;
  return stored.total;
}

export async function probeEdges(db: D1Database): Promise<{ max_id: number | null; date_max: string | null }> {
  const row = await db
    .prepare("SELECT (SELECT MAX(id) FROM sales) AS max_id, (SELECT MAX(date) FROM sales) AS date_max")
    .first<{ max_id: number | null; date_max: string | null }>();
  return {
    max_id: row?.max_id ?? null,
    date_max: row?.date_max ?? null,
  };
}

async function refreshStats(db: D1Database): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = rebuildStats(db).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function rebuildStats(db: D1Database): Promise<void> {
  const grouped = await db
    .prepare(
      `SELECT extension, venue,
              COUNT(*) AS n,
              SUM(price_is_estimate) AS estimates,
              MIN(date) AS date_min,
              MAX(date) AS date_max,
              MAX(id) AS max_id
       FROM sales
       GROUP BY extension, venue`,
    )
    .all<Record<string, unknown>>();
  const stats = foldStats(grouped.results.map(asGroup));
  const refreshedAt = new Date().toISOString();
  const statements = [
    db.prepare("DELETE FROM sales_stats_extension"),
    db.prepare("DELETE FROM sales_stats_venue"),
    db.prepare("DELETE FROM sales_stats"),
    db.prepare(
      `INSERT INTO sales_stats (id, total, estimates, unknown_venues, date_min, date_max, max_id, refreshed_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(stats.total, stats.estimates, stats.unknown_venues, stats.date_min, stats.date_max, stats.max_id, refreshedAt),
  ];
  if (stats.extensions.length) {
    statements.push(
      db.prepare(
        `INSERT INTO sales_stats_extension (extension, n) VALUES ${stats.extensions.map(() => "(?, ?)").join(", ")}`,
      ).bind(...stats.extensions.flatMap((row) => [row.extension, row.count])),
    );
  }
  if (stats.venues.length) {
    statements.push(
      db.prepare(
        `INSERT INTO sales_stats_venue (venue, n) VALUES ${stats.venues.map(() => "(?, ?)").join(", ")}`,
      ).bind(...stats.venues.flatMap((row) => [row.venue, row.count])),
    );
  }
  await db.batch(statements);
  clearCountCache();
}

async function readStats(db: D1Database): Promise<(CatalogStats & { refreshed_at: string }) | null> {
  const [summary, extensions, venues] = await db.batch([
    db.prepare("SELECT total, estimates, unknown_venues, date_min, date_max, max_id, refreshed_at FROM sales_stats WHERE id = 1"),
    db.prepare("SELECT extension, n FROM sales_stats_extension"),
    db.prepare("SELECT venue, n FROM sales_stats_venue"),
  ]);
  const row = summary.results[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    total: asNumber(row.total),
    estimates: asNumber(row.estimates),
    unknown_venues: asNumber(row.unknown_venues),
    date_min: asString(row.date_min),
    date_max: asString(row.date_max),
    max_id: asNumber(row.max_id),
    refreshed_at: asString(row.refreshed_at) ?? "",
    extensions: (extensions.results as { extension: string; n: number }[])
      .map((item) => ({ extension: item.extension, count: asNumber(item.n) }))
      .sort((left, right) => right.count - left.count || left.extension.localeCompare(right.extension)),
    venues: (venues.results as { venue: string; n: number }[])
      .map((item) => ({ venue: item.venue, count: asNumber(item.n) }))
      .sort((left, right) => right.count - left.count || left.venue.localeCompare(right.venue)),
  };
}

async function ensureStatsTables(db: D1Database): Promise<void> {
  if (tablesReady) return;
  await db.batch(ENSURE_SQL.map((sql) => db.prepare(sql)));
  tablesReady = true;
}

function asGroup(row: Record<string, unknown>): StatsGroup {
  return {
    extension: asString(row.extension) ?? "",
    venue: asString(row.venue) ?? "",
    n: asNumber(row.n),
    estimates: asNumber(row.estimates),
    date_min: asString(row.date_min),
    date_max: asString(row.date_max),
    max_id: asNumber(row.max_id),
  };
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value !== "") return Number(value);
  return 0;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
