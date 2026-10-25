import { foldStats, shouldRebuild, statsAreStale, type CatalogStats, type RebuildMode } from "../shared/stats";
import { clearCountCache } from "./count-cache";

/** No bound parameters. D1 allows at most 100 per statement, and there are more extensions than that. */
export const INSERT_EXTENSION_STATS_SQL =
  "INSERT INTO sales_stats_extension (extension, n) SELECT extension, COUNT(*) FROM sales GROUP BY extension";

export const INSERT_VENUE_STATS_SQL =
  "INSERT INTO sales_stats_venue (venue, n) SELECT venue, COUNT(*) FROM sales GROUP BY venue";

/** Summary table only. Ordered for the extension picker; no scan of `sales`. */
export const EXTENSION_CATALOG_SQL =
  "SELECT extension, n FROM sales_stats_extension ORDER BY n DESC, extension ASC";

/** The timestamp is the only bound parameter. */
export const INSERT_SUMMARY_STATS_SQL = `INSERT INTO sales_stats
  (id, total, estimates, unknown_venues, date_min, date_max, max_id, refreshed_at)
  SELECT 1,
         COUNT(*),
         COALESCE(SUM(price_is_estimate), 0),
         COALESCE(SUM(CASE WHEN venue = 'Unknown' THEN 1 ELSE 0 END), 0),
         MIN(date),
         MAX(date),
         COALESCE(MAX(id), 0),
         ?
  FROM sales`;

export interface StoredStats extends CatalogStats {
  refreshed_at: string;
  stale: boolean;
  refresh: "none" | "rebuilt" | "skipped";
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

export async function metaStats(db: D1Database, mode: RebuildMode, now = Date.now()): Promise<StoredStats> {
  await ensureStatsTables(db);
  const existing = await readStats(db);
  const allowed = shouldRebuild(mode, existing?.refreshed_at ?? null, now);
  let refresh: StoredStats["refresh"] = "none";
  if (allowed) {
    await refreshStats(db);
    refresh = "rebuilt";
  } else if (mode === "public") {
    refresh = "skipped";
  }
  const stored = await readStats(db);
  const probe = await probeEdges(db);
  if (!stored) {
    return { ...foldStats([]), refreshed_at: new Date(now).toISOString(), stale: true, refresh };
  }
  return { ...stored, stale: statsAreStale(stored, probe), refresh };
}

/** Nightly cron entry. Ignores the public interval. */
export function rebuildCatalog(db: D1Database): Promise<void> {
  return refreshStats(db);
}

export async function extensionCatalog(db: D1Database): Promise<{ extension: string; count: number }[]> {
  await ensureStatsTables(db);
  const result = await db.prepare(EXTENSION_CATALOG_SQL).all<{ extension: string; n: number }>();
  return result.results.map((row) => ({ extension: row.extension, count: asNumber(row.n) }));
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
  const refreshedAt = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM sales_stats_extension"),
    db.prepare(INSERT_EXTENSION_STATS_SQL),
    db.prepare("DELETE FROM sales_stats_venue"),
    db.prepare(INSERT_VENUE_STATS_SQL),
    db.prepare("DELETE FROM sales_stats"),
    db.prepare(INSERT_SUMMARY_STATS_SQL).bind(refreshedAt),
  ]);
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

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value !== "") return Number(value);
  return 0;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
