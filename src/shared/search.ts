import { normalizeKeyword } from "./domain";
import { addUtcDays, isIsoDate, todayUtc } from "./dates";
import type { MatchApplied } from "./types";

export type MatchMode = "contains" | "starts" | "ends" | "exact";
export type TriState = "any" | "exclude" | "only";
export type SortKey = "date" | "price" | "domain" | "length";
export type SortDir = "asc" | "desc";
export type EstimateMode = "include" | "exclude";
export type PrecisionMode = "any" | "day" | "month";
export type ViewMode = "search" | "top" | "recent";

export interface SalesFilter {
  q: string;
  match: MatchMode;
  extensions: string[];
  venues: string[];
  priceMin: number | null;
  priceMax: number | null;
  dateFrom: string | null;
  dateTo: string | null;
  lengthMin: number | null;
  lengthMax: number | null;
  digits: TriState;
  hyphens: TriState;
  estimates: EstimateMode;
  precision: PrecisionMode;
  sort: SortKey;
  dir: SortDir;
  page: number;
  pageSize: number;
}

export interface BuiltSql {
  sql: string;
  countSql: string;
  binds: SqlValue[];
  countBinds: SqlValue[];
  matchApplied: MatchApplied;
  notice: string | null;
}

type SqlValue = string | number;

const PAGE_SIZES = new Set([25, 50, 100]);
const MAX_PAGE_OFFSET = 100_000;
const LIKE_LIMIT_BYTES = 50;

const SORT_SQL: Record<SortKey, string> = {
  date: "s.date",
  price: "s.price_usd",
  domain: "s.domain",
  length: "s.length",
};

export interface FilterDefaults {
  estimates?: EstimateMode;
  precision?: PrecisionMode;
  sort?: SortKey;
  dir?: SortDir;
  pageSize?: number;
}

export function viewDefaults(view: ViewMode): FilterDefaults {
  if (view === "top") return { estimates: "exclude", precision: "any", sort: "price", dir: "desc" };
  if (view === "recent") return { estimates: "exclude", precision: "day", sort: "date", dir: "desc" };
  return { estimates: "include", precision: "any", sort: "date", dir: "desc" };
}

export type ParseResult = { ok: true; filter: SalesFilter } | { ok: false; message: string };

export function parseFilter(params: URLSearchParams, defaults: FilterDefaults = {}): ParseResult {
  try {
    const filter: SalesFilter = {
      q: "",
      match: "contains",
      extensions: [],
      venues: [],
      priceMin: null,
      priceMax: null,
      dateFrom: null,
      dateTo: null,
      lengthMin: null,
      lengthMax: null,
      digits: "any",
      hyphens: "any",
      estimates: defaults.estimates ?? "include",
      precision: defaults.precision ?? "any",
      sort: defaults.sort ?? "date",
      dir: defaults.dir ?? "desc",
      page: 1,
      pageSize: defaults.pageSize ?? 50,
    };

    const keyword = normalizeKeyword(params.get("q") ?? "");
    if (keyword.startsWith(".")) {
      return { ok: false, message: "To filter by extension, use the extension control." };
    }
    if (keyword && !/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(keyword)) {
      return { ok: false, message: "Keywords can use letters, numbers, hyphens, and dots." };
    }
    if (keyword.length > 253) return { ok: false, message: "That keyword is too long." };
    filter.q = keyword;

    const match = params.get("match");
    if (match) {
      if (!isMatch(match)) return { ok: false, message: "match must be contains, starts, ends, or exact." };
      filter.match = match;
    }

    filter.extensions = readList(params, "ext").map(normalizeExtension);
    if (filter.extensions.length > 20) return { ok: false, message: "Choose at most 20 extensions." };
    for (const extension of filter.extensions) {
      if (!/^\.[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(extension)) {
        return { ok: false, message: `Unknown extension “${extension}”.` };
      }
    }

    filter.venues = readList(params, "venue");
    if (filter.venues.length > 20) return { ok: false, message: "Choose at most 20 venues." };
    for (const venue of filter.venues) {
      if (!/^[\w .&+-]{1,40}$/.test(venue)) {
        return { ok: false, message: `Unknown venue “${venue}”.` };
      }
    }

    filter.priceMin = readMoney(params, "price_min");
    filter.priceMax = readMoney(params, "price_max");
    if (
      filter.priceMin != null &&
      filter.priceMax != null &&
      filter.priceMin > filter.priceMax
    ) {
      return { ok: false, message: "Minimum price is higher than maximum price." };
    }

    filter.dateFrom = readDate(params, "date_from");
    filter.dateTo = readDate(params, "date_to");
    if (filter.dateFrom && filter.dateTo && filter.dateFrom > filter.dateTo) {
      return { ok: false, message: "The start date is after the end date." };
    }

    filter.lengthMin = readLength(params, "length_min");
    filter.lengthMax = readLength(params, "length_max");
    if (
      filter.lengthMin != null &&
      filter.lengthMax != null &&
      filter.lengthMin > filter.lengthMax
    ) {
      return { ok: false, message: "Minimum length is higher than maximum length." };
    }

    filter.digits = readTri(params, "digits");
    filter.hyphens = readTri(params, "hyphens");

    const estimates = params.get("estimates");
    if (estimates) {
      if (estimates !== "include" && estimates !== "exclude") {
        return { ok: false, message: "estimates must be include or exclude." };
      }
      filter.estimates = estimates;
    }

    const precision = params.get("precision");
    if (precision) {
      if (precision !== "any" && precision !== "day" && precision !== "month") {
        return { ok: false, message: "precision must be any, day, or month." };
      }
      filter.precision = precision;
    }

    const sort = params.get("sort");
    if (sort) {
      if (!isSort(sort)) return { ok: false, message: "sort must be date, price, domain, or length." };
      filter.sort = sort;
    }
    const dir = params.get("dir");
    if (dir) {
      if (dir !== "asc" && dir !== "desc") return { ok: false, message: "dir must be asc or desc." };
      filter.dir = dir;
    }

    const page = params.get("page");
    if (page) {
      const value = Number(page);
      if (!Number.isInteger(value) || value < 1) return { ok: false, message: "page must be a positive integer." };
      filter.page = value;
    }
    const pageSize = params.get("page_size");
    if (pageSize) {
      const value = Number(pageSize);
      if (!PAGE_SIZES.has(value)) return { ok: false, message: "page_size must be 25, 50, or 100." };
      filter.pageSize = value;
    }

    const offset = (filter.page - 1) * filter.pageSize;
    if (offset > MAX_PAGE_OFFSET) return { ok: false, message: "That page is too deep. Narrow the filters." };

    return { ok: true, filter };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Invalid search." };
  }
}

export function filterToParams(filter: SalesFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.q) {
    params.set("q", filter.q);
    if (filter.match !== "contains") params.set("match", filter.match);
  }
  for (const extension of filter.extensions) params.append("ext", extension.replace(/^\./, ""));
  for (const venue of filter.venues) params.append("venue", venue);
  if (filter.priceMin != null) params.set("price_min", String(filter.priceMin));
  if (filter.priceMax != null) params.set("price_max", String(filter.priceMax));
  if (filter.dateFrom) params.set("date_from", filter.dateFrom);
  if (filter.dateTo) params.set("date_to", filter.dateTo);
  if (filter.lengthMin != null) params.set("length_min", String(filter.lengthMin));
  if (filter.lengthMax != null) params.set("length_max", String(filter.lengthMax));
  if (filter.digits !== "any") params.set("digits", filter.digits);
  if (filter.hyphens !== "any") params.set("hyphens", filter.hyphens);
  params.set("estimates", filter.estimates);
  if (filter.precision !== "any") params.set("precision", filter.precision);
  params.set("sort", filter.sort);
  params.set("dir", filter.dir);
  if (filter.page > 1) params.set("page", String(filter.page));
  if (filter.pageSize !== 50) params.set("page_size", String(filter.pageSize));
  return params;
}

export function buildSalesQuery(filter: SalesFilter): BuiltSql {
  const where: string[] = [];
  const binds: SqlValue[] = [];
  let matchApplied: MatchApplied = "none";
  let notice: string | null = null;
  let useFts = false;

  if (filter.q) {
    const domainQuery = filter.q.includes(".");
    const column = domainQuery ? "s.domain" : "s.sld";
    if (filter.match === "exact") {
      where.push(`${column} = ?`);
      binds.push(filter.q);
      matchApplied = "exact";
    } else if (filter.match === "starts" || (filter.match === "contains" && !domainQuery && filter.q.length < 3)) {
      const pattern = likePattern("prefix", filter.q);
      where.push(`${column} LIKE ? ESCAPE '\\'`);
      binds.push(pattern.pattern);
      matchApplied = "prefix";
      if (filter.match === "contains") {
        notice = "Names are matched from the start when the keyword is shorter than 3 characters.";
      }
      if (pattern.trimmed) notice = "The keyword was shortened to fit the 50-byte search limit.";
    } else if (filter.match === "ends") {
      const pattern = likePattern("suffix", filter.q);
      where.push(`${column} LIKE ? ESCAPE '\\'`);
      binds.push(pattern.pattern);
      matchApplied = "suffix";
      if (pattern.trimmed) notice = "The keyword was shortened to fit the 50-byte search limit.";
    } else if (!domainQuery && filter.q.length >= 3) {
      where.push("sales_fts MATCH ?");
      binds.push(ftsPhrase(filter.q));
      matchApplied = "fts";
      useFts = true;
    } else {
      const pattern = likePattern("contains", filter.q);
      where.push(`${column} LIKE ? ESCAPE '\\'`);
      binds.push(pattern.pattern);
      matchApplied = "like";
      if (pattern.trimmed) notice = "The keyword was shortened to fit the 50-byte search limit.";
    }
  }

  if (filter.extensions.length) {
    where.push(`s.extension IN (${filter.extensions.map(() => "?").join(", ")})`);
    binds.push(...filter.extensions);
  }
  if (filter.venues.length) {
    where.push(`s.venue IN (${filter.venues.map(() => "?").join(", ")})`);
    binds.push(...filter.venues);
  }
  if (filter.priceMin != null) {
    where.push("s.price_usd >= ?");
    binds.push(filter.priceMin);
  }
  if (filter.priceMax != null) {
    where.push("s.price_usd <= ?");
    binds.push(filter.priceMax);
  }
  if (filter.dateFrom) {
    where.push("s.date >= ?");
    binds.push(filter.dateFrom);
  }
  if (filter.dateTo) {
    where.push("s.date <= ?");
    binds.push(filter.dateTo);
  }
  if (filter.lengthMin != null) {
    where.push("s.length >= ?");
    binds.push(filter.lengthMin);
  }
  if (filter.lengthMax != null) {
    where.push("s.length <= ?");
    binds.push(filter.lengthMax);
  }
  if (filter.digits === "exclude") where.push("s.has_digit = 0");
  if (filter.digits === "only") where.push("s.has_digit = 1");
  if (filter.hyphens === "exclude") where.push("s.has_hyphen = 0");
  if (filter.hyphens === "only") where.push("s.has_hyphen = 1");
  if (filter.estimates === "exclude") where.push("s.price_is_estimate = 0");
  if (filter.precision === "day") where.push("s.date_precision = 'day'");
  if (filter.precision === "month") where.push("s.date_precision = 'month'");

  const from = useFts ? "sales s JOIN sales_fts ON sales_fts.rowid = s.id" : "sales s";
  const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const order = orderBy(filter.sort, filter.dir);
  const offset = (filter.page - 1) * filter.pageSize;

  return {
    sql: `SELECT s.* FROM ${from}${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    countSql: `SELECT COUNT(*) AS n FROM ${from}${whereSql}`,
    binds: [...binds, filter.pageSize, offset],
    countBinds: binds,
    matchApplied,
    notice,
  };
}

export function recentWindow(days: number, asOf = todayUtc()): { from: string; to: string; days: number } {
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error("days must be between 1 and 3650.");
  }
  if (!isIsoDate(asOf)) throw new Error("as_of must be YYYY-MM-DD.");
  return { from: addUtcDays(asOf, -days), to: asOf, days };
}

function orderBy(sort: SortKey, dir: SortDir): string {
  const column = SORT_SQL[sort];
  const direction = dir === "asc" ? "ASC" : "DESC";
  if (sort === "date") return `${column} ${direction}, s.price_usd DESC, s.id DESC`;
  if (sort === "price") return `${column} ${direction}, s.date DESC, s.id DESC`;
  if (sort === "length") return `${column} ${direction}, s.domain ASC, s.id DESC`;
  return `${column} ${direction}, s.id DESC`;
}

function ftsPhrase(keyword: string): string {
  return `"${keyword.replaceAll('"', '""')}"`;
}

function likePattern(kind: "prefix" | "suffix" | "contains", keyword: string): { pattern: string; trimmed: boolean } {
  let core = keyword;
  let trimmed = false;
  for (;;) {
    const escaped = escapeLike(core);
    const pattern =
      kind === "prefix" ? `${escaped}%` : kind === "suffix" ? `%${escaped}` : `%${escaped}%`;
    if (byteLength(pattern) <= LIKE_LIMIT_BYTES) return { pattern, trimmed };
    if (!core) return { pattern: kind === "contains" ? "%%" : "%", trimmed: true };
    core = core.slice(0, -1);
    trimmed = true;
  }
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function readList(params: URLSearchParams, key: string): string[] {
  const values: string[] = [];
  for (const value of params.getAll(key)) {
    for (const part of value.split(",")) {
      const trimmed = part.trim();
      if (trimmed) values.push(trimmed);
    }
  }
  return [...new Set(values)];
}

function normalizeExtension(value: string): string {
  const lower = value.trim().toLowerCase();
  return lower.startsWith(".") ? lower : `.${lower}`;
}

function readMoney(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw == null || raw === "") return null;
  if (!/^\d+$/.test(raw)) throw new Error(`${key} must be a whole number of dollars.`);
  const value = Number(raw);
  if (value > 2_000_000_000) throw new Error(`${key} is too large.`);
  return value;
}

function readDate(params: URLSearchParams, key: string): string | null {
  const raw = params.get(key);
  if (raw == null || raw === "") return null;
  if (!isIsoDate(raw)) throw new Error(`${key} must be YYYY-MM-DD.`);
  return raw;
}

function readLength(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw == null || raw === "") return null;
  if (!/^\d+$/.test(raw)) throw new Error(`${key} must be a whole number.`);
  const value = Number(raw);
  if (value < 1 || value > 63) throw new Error(`${key} must be between 1 and 63.`);
  return value;
}

function readTri(params: URLSearchParams, key: string): TriState {
  const raw = params.get(key);
  if (!raw || raw === "any") return "any";
  if (raw === "exclude" || raw === "only") return raw;
  throw new Error(`${key} must be any, exclude, or only.`);
}

function isMatch(value: string): value is MatchMode {
  return value === "contains" || value === "starts" || value === "ends" || value === "exact";
}

function isSort(value: string): value is SortKey {
  return value === "date" || value === "price" || value === "domain" || value === "length";
}

export function readView(params: URLSearchParams): ViewMode {
  const view = params.get("view");
  if (view === "top" || view === "recent") return view;
  return "search";
}

export function readDays(params: URLSearchParams): number {
  const raw = params.get("days");
  if (!raw) return 30;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 3650) return 30;
  return value;
}
