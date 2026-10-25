import { normalizeDomain, sldDomainBounds } from "../shared/domain";
import {
  SEARCH_COUNT_CAP,
  buildSalesQuery,
  parseFilter,
  recentWindow,
  resultPages,
  type SalesFilter,
} from "../shared/search";
import { interpretCount, type RebuildMode } from "../shared/stats";
import type { CompsResponse, DomainResponse, MetaResponse, Sale, SearchResponse } from "../shared/types";
import { cachedCount } from "./count-cache";
import type { Env } from "./env";
import { freshCatalogTotal, metaStats, probeEdges } from "./stats";

/** No DISTINCT, GROUP BY, or LIMIT. Resales of one domain all come back, newest first. */
export const DOMAIN_SALES_SQL =
  "SELECT * FROM sales INDEXED BY idx_sales_domain WHERE domain = ? ORDER BY date DESC, price_usd DESC, id DESC";

const SAME_NAME_SQL = `SELECT * FROM sales INDEXED BY idx_sales_domain
 WHERE domain >= ? AND domain < ? AND domain != ?
 ORDER BY date DESC, price_usd DESC, id DESC
 LIMIT 12`;

const SIMILAR_LENGTH_SQL = `SELECT * FROM sales INDEXED BY idx_sales_date
 WHERE extension = ? AND length BETWEEN ? AND ? AND sld != ?
 ORDER BY date DESC, price_usd DESC, id DESC
 LIMIT 24`;

const NEARBY_ABOVE_SQL = `SELECT * FROM sales INDEXED BY idx_sales_ext_price
 WHERE extension = ? AND price_is_estimate = 0 AND price_usd >= ? AND price_usd <= ? AND sld != ?
 ORDER BY price_usd ASC
 LIMIT 20`;

const NEARBY_BELOW_SQL = `SELECT * FROM sales INDEXED BY idx_sales_ext_price
 WHERE extension = ? AND price_is_estimate = 0 AND price_usd >= ? AND price_usd < ? AND sld != ?
 ORDER BY price_usd DESC
 LIMIT 20`;

type SqlValue = string | number;

export async function searchSales(
  db: D1Database,
  filter: SalesFilter,
  extra?: SearchResponse["window"],
  origin?: string,
): Promise<SearchResponse> {
  const built = buildSalesQuery(filter);
  const started = Date.now();
  if (built.skipped) {
    return {
      total: 0,
      total_exact: true,
      page: filter.page,
      page_size: filter.pageSize,
      pages: 1,
      elapsed_ms: Date.now() - started,
      match_applied: built.matchApplied,
      notice: built.notice,
      window: extra,
      results: [],
    };
  }
  const [page, counted] = await Promise.all([
    db.prepare(built.sql).bind(...built.binds).all<Sale>(),
    resolveCount(db, built, origin),
  ]);
  const notice = counted.exact
    ? built.notice
    : [built.notice, `More than ${SEARCH_COUNT_CAP.toLocaleString("en-US")} sales match. Add a filter to narrow them.`]
        .filter(Boolean)
        .join(" ");
  return {
    total: counted.total,
    total_exact: counted.exact,
    page: filter.page,
    page_size: filter.pageSize,
    pages: resultPages(counted.total, filter.pageSize),
    elapsed_ms: Date.now() - started,
    match_applied: built.matchApplied,
    notice,
    window: extra,
    results: page.results,
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

  const sameBounds = sldDomainBounds(basis.sld);
  const sameName = await all<Sale>(db, SAME_NAME_SQL, [sameBounds.low, sameBounds.high, basis.domain]);
  for (const sale of sameName) seen.add(sale.id);

  const keyword = await similarKeyword(db, basis);
  const similarKeywordRows = takeNew(keyword, seen, 8);

  const low = Math.max(1, basis.length - 1);
  const high = basis.length + 1;
  const similarLength = takeNew(
    await all<Sale>(db, SIMILAR_LENGTH_SQL, [basis.extension, low, high, basis.sld]),
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

export async function meta(db: D1Database, mode: RebuildMode = "auto"): Promise<MetaResponse> {
  const stats = await metaStats(db, mode);
  return {
    total: stats.total,
    estimates: stats.estimates,
    unknown_venues: stats.unknown_venues,
    date_min: stats.date_min,
    date_max: stats.date_max,
    extensions: stats.extensions,
    venues: stats.venues,
    refreshed_at: stats.refreshed_at,
    stale: stats.stale,
    refresh: stats.refresh,
  };
}

/** Cheap liveness check. `sales` is the cached catalog total, or null when that cache lags the load. */
export async function healthStatus(db: D1Database): Promise<{ ok: true; sales: number | null; stale: boolean }> {
  const edges = await probeEdges(db);
  const total = await freshCatalogTotal(db, Promise.resolve(edges));
  return { ok: true, sales: total, stale: total == null && (edges.max_id != null || edges.date_max != null) };
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
  const [above, below] = await Promise.all([
    all<Sale>(db, NEARBY_ABOVE_SQL, [basis.extension, anchor, high, basis.sld]),
    all<Sale>(db, NEARBY_BELOW_SQL, [basis.extension, low, anchor, basis.sld]),
  ]);
  const merged = new Map<number, Sale>();
  for (const sale of [...above, ...below]) merged.set(sale.id, sale);
  return [...merged.values()].sort(
    (left, right) =>
      Math.abs(left.price_usd - anchor) - Math.abs(right.price_usd - anchor) ||
      right.date.localeCompare(left.date) ||
      right.id - left.id,
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

async function resolveCount(
  db: D1Database,
  built: ReturnType<typeof buildSalesQuery>,
  origin: string | undefined,
): Promise<{ total: number; exact: boolean }> {
  // The latest id is one primary-key lookup. It keeps a cached count from
  // describing a table that has since gained a row.
  const probe = probeEdges(db);
  if (built.useCatalogTotal) {
    const catalog = await freshCatalogTotal(db, probe);
    if (catalog != null) return { total: catalog, exact: true };
  }
  const edges = await probe;
  const key = `${edges.max_id ?? 0}|${edges.date_max ?? ""}\n${built.countSql}\n${JSON.stringify(built.countBinds)}`;
  return cachedCount(origin, key, async () => {
    const count = await db.prepare(built.countSql).bind(...built.countBinds).first<{ n: number }>();
    return interpretCount(count?.n ?? 0, SEARCH_COUNT_CAP);
  });
}

async function all<T>(db: D1Database, sql: string, binds: SqlValue[]): Promise<T[]> {
  const result = await db.prepare(sql).bind(...binds).all<T>();
  return result.results;
}

export type WorkerEnv = Env;
