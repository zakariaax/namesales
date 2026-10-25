import { normalizeDomain } from "../shared/domain";
import {
  buildSalesQuery,
  parseFilter,
  recentWindow,
  type SalesFilter,
} from "../shared/search";
import type { CompsResponse, DomainResponse, MetaResponse, Sale, SearchResponse } from "../shared/types";
import type { Env } from "./env";

/** No DISTINCT, GROUP BY, or LIMIT. Resales of one domain all come back, newest first. */
export const DOMAIN_SALES_SQL =
  "SELECT * FROM sales WHERE domain = ? ORDER BY date DESC, price_usd DESC, id DESC";

type SqlValue = string | number;

export async function searchSales(db: D1Database, filter: SalesFilter, extra?: SearchResponse["window"]): Promise<SearchResponse> {
  const built = buildSalesQuery(filter);
  const started = Date.now();
  const [page, count] = await db.batch([
    db.prepare(built.sql).bind(...built.binds),
    db.prepare(built.countSql).bind(...built.countBinds),
  ]);
  const total = numberField(count.results[0], "n");
  const pages = Math.max(1, Math.ceil(total / filter.pageSize));
  return {
    total,
    page: filter.page,
    page_size: filter.pageSize,
    pages,
    elapsed_ms: Date.now() - started,
    match_applied: built.matchApplied,
    notice: built.notice,
    window: extra,
    results: page.results as Sale[],
  };
}

export async function domainSales(db: D1Database, rawDomain: string): Promise<DomainResponse | null> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) return null;
  // Every row is a sale. The same domain on another date is a resale, not a duplicate.
  const rows = await all<Sale>(db, DOMAIN_SALES_SQL, [domain]);
  if (!rows.length) return null;
  const exact = rows.filter((row) => row.price_is_estimate === 0);
  const latest = rows[0];
  return {
    domain,
    sld: latest.sld,
    extension: latest.extension,
    length: latest.length,
    tld_levels: latest.tld_levels,
    is_idn: latest.is_idn,
    summary: {
      count: rows.length,
      exact_count: exact.length,
      max_exact_price: exact.length ? Math.max(...exact.map((row) => row.price_usd)) : null,
      latest_date: latest.date,
      latest_precision: latest.date_precision,
    },
    sales: rows,
  };
}

export async function domainComps(db: D1Database, rawDomain: string): Promise<CompsResponse | null> {
  const detail = await domainSales(db, rawDomain);
  if (!detail) return null;
  const basis = detail.sales[0];
  const seen = new Set<number>(detail.sales.map((sale) => sale.id));

  const sameName = await all<Sale>(
    db,
    `SELECT * FROM sales WHERE sld = ? AND domain != ?
     ORDER BY date DESC, price_usd DESC, id DESC LIMIT 12`,
    [basis.sld, basis.domain],
  );
  for (const sale of sameName) seen.add(sale.id);

  const keyword = await similarKeyword(db, basis);
  const similarKeywordRows = takeNew(keyword, seen, 8);

  const low = Math.max(1, basis.length - 1);
  const high = basis.length + 1;
  const similarLength = takeNew(
    await all<Sale>(
      db,
      `SELECT * FROM sales
       WHERE extension = ? AND length BETWEEN ? AND ? AND sld != ?
       ORDER BY date DESC, price_usd DESC, id DESC
       LIMIT 24`,
      [basis.extension, low, high, basis.sld],
    ),
    seen,
    8,
  );

  const nearby = takeNew(await nearbyPrice(db, basis), seen, 8);

  return {
    domain: detail.domain,
    basis,
    same_name: sameName,
    similar_keyword: similarKeywordRows,
    similar_length: similarLength,
    nearby_price: nearby,
  };
}

export async function meta(db: D1Database): Promise<MetaResponse> {
  const [extensions, venues, summary] = await db.batch([
    db.prepare(
      `SELECT extension, COUNT(*) AS n FROM sales GROUP BY extension ORDER BY n DESC, extension ASC`,
    ),
    db.prepare(`SELECT venue, COUNT(*) AS n FROM sales GROUP BY venue ORDER BY n DESC, venue ASC`),
    db.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(price_is_estimate), 0) AS estimates,
              COALESCE(SUM(CASE WHEN venue = 'Unknown' THEN 1 ELSE 0 END), 0) AS unknown_venues,
              MIN(date) AS date_min,
              MAX(date) AS date_max
       FROM sales`,
    ),
  ]);
  const summaryRow = (summary.results[0] ?? {}) as Record<string, unknown>;
  return {
    total: numberField(summaryRow, "total"),
    estimates: numberField(summaryRow, "estimates"),
    unknown_venues: numberField(summaryRow, "unknown_venues"),
    date_min: stringOrNull(summaryRow.date_min),
    date_max: stringOrNull(summaryRow.date_max),
    extensions: (extensions.results as { extension: string; n: number }[]).map((row) => ({
      extension: row.extension,
      count: row.n,
    })),
    venues: (venues.results as { venue: string; n: number }[]).map((row) => ({
      venue: row.venue,
      count: row.n,
    })),
  };
}

export async function healthCount(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM sales").first<{ n: number }>();
  return row?.n ?? 0;
}

export function filterFromUrl(url: URL, preset: "search" | "top" | "recent"): { filter: SalesFilter; window?: SearchResponse["window"] } | { error: string } {
  const parsed = parseFilter(url.searchParams, preset === "top"
    ? { estimates: "exclude", sort: "price", dir: "desc" }
    : preset === "recent"
      ? { estimates: "exclude", precision: "day", sort: "date", dir: "desc" }
      : {});
  if (!parsed.ok) return { error: parsed.message };
  const filter = parsed.filter;
  if (preset !== "recent") return { filter };

  let days = 30;
  const rawDays = url.searchParams.get("days");
  if (rawDays) {
    days = Number(rawDays);
    if (!Number.isInteger(days)) return { error: "days must be a whole number." };
  }
  const asOf = url.searchParams.get("as_of") ?? undefined;
  try {
    const window = recentWindow(days, asOf);
    filter.dateFrom = window.from;
    filter.dateTo = window.to;
    return { filter, window };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid window." };
  }
}

async function similarKeyword(db: D1Database, basis: Sale): Promise<Sale[]> {
  const stem = basis.sld.replaceAll("-", "");
  const rows: Sale[] = [];
  if (stem.length >= 3) {
    const phrase = `"${stem.replaceAll('"', '""')}"`;
    rows.push(
      ...(await all<Sale>(
        db,
        `SELECT s.* FROM sales s
         JOIN sales_fts ON sales_fts.rowid = s.id
         WHERE sales_fts MATCH ? AND s.sld != ?
         ORDER BY s.date DESC
         LIMIT 40`,
        [phrase, basis.sld],
      )),
    );
  }
  if (stem.length >= 5) {
    const prefix = `${escapeLike(basis.sld.slice(0, 5))}%`;
    rows.push(
      ...(await all<Sale>(
        db,
        `SELECT * FROM sales WHERE sld LIKE ? ESCAPE '\\' AND sld != ?
         ORDER BY date DESC LIMIT 80`,
        [prefix, basis.sld],
      )),
    );
  }
  const ranked = rows
    .filter((sale, index) => rows.findIndex((other) => other.id === sale.id) === index)
    .filter((sale) => keywordClose(stem, sale.sld))
    .sort((a, b) => Math.abs(a.length - basis.length) - Math.abs(b.length - basis.length) || b.date.localeCompare(a.date));
  return ranked;
}

async function nearbyPrice(db: D1Database, basis: Sale): Promise<Sale[]> {
  const anchor = basis.price_is_estimate ? (basis.price_min_usd ?? basis.price_usd) : basis.price_usd;
  if (anchor <= 0) return [];
  const low = Math.max(1, Math.floor(anchor * 0.7));
  const high = Math.ceil(anchor * 1.3);
  return all<Sale>(
    db,
    `SELECT * FROM sales
     WHERE extension = ?
       AND price_is_estimate = 0
       AND price_usd BETWEEN ? AND ?
       AND sld != ?
     ORDER BY ABS(price_usd - ?) ASC, date DESC
     LIMIT 16`,
    [basis.extension, low, high, basis.sld, anchor],
  );
}

function keywordClose(stem: string, sld: string): boolean {
  const other = sld.replaceAll("-", "");
  if (!other) return false;
  if (other === stem) return true;
  if (stem.length >= 3 && other.includes(stem)) return true;
  if (stem.length >= 5 && other.length >= 5 && stem.includes(other)) return true;
  return false;
}

function takeNew(rows: Sale[], seen: Set<number>, limit: number): Sale[] {
  const kept: Sale[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    kept.push(row);
    if (kept.length >= limit) break;
  }
  return kept;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

async function all<T>(db: D1Database, sql: string, binds: SqlValue[]): Promise<T[]> {
  const result = await db.prepare(sql).bind(...binds).all<T>();
  return result.results;
}

function numberField(row: unknown, key: string): number {
  if (!row || typeof row !== "object") return 0;
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "number" ? value : Number(value ?? 0);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export type WorkerEnv = Env;
