/** Column order matches the prepared `sales` table. Do not reorder. */
export const SALE_COLUMNS = [
  "id",
  "domain",
  "sld",
  "extension",
  "date",
  "date_precision",
  "price_usd",
  "price_is_estimate",
  "price_range",
  "price_min_usd",
  "price_max_usd",
  "venue",
  "source",
  "source_original",
  "source_url",
  "also_reported_by",
  "price_note",
  "original_price",
  "origin_file",
  "length",
  "has_hyphen",
  "has_digit",
  "is_numeric",
  "is_idn",
  "tld_levels",
] as const;

export type SaleColumn = (typeof SALE_COLUMNS)[number];

export const INT_COLUMNS: ReadonlySet<SaleColumn> = new Set([
  "id",
  "price_usd",
  "price_is_estimate",
  "price_min_usd",
  "price_max_usd",
  "length",
  "has_hyphen",
  "has_digit",
  "is_numeric",
  "is_idn",
  "tld_levels",
]);

export interface Sale {
  id: number;
  domain: string;
  sld: string;
  extension: string;
  date: string;
  date_precision: "day" | "month";
  price_usd: number;
  price_is_estimate: number;
  price_range: string | null;
  price_min_usd: number | null;
  price_max_usd: number | null;
  venue: string;
  source: string;
  source_original: string | null;
  source_url: string | null;
  also_reported_by: string | null;
  price_note: string | null;
  original_price: string | null;
  origin_file: string | null;
  length: number;
  has_hyphen: number;
  has_digit: number;
  is_numeric: number;
  is_idn: number;
  tld_levels: number;
}

export interface SearchResponse {
  /** Exact total, or the cap when the match set is larger than the count probe. */
  total: number;
  total_exact: boolean;
  page: number;
  page_size: number;
  pages: number;
  elapsed_ms: number;
  match_applied: MatchApplied;
  notice: string | null;
  window?: { from: string; to: string; days: number };
  results: Sale[];
}

export type MatchApplied = "none" | "fts" | "prefix" | "suffix" | "exact" | "like";

export interface DomainResponse {
  domain: string;
  sld: string;
  extension: string;
  length: number;
  tld_levels: number;
  is_idn: number;
  summary: {
    count: number;
    exact_count: number;
    max_exact_price: number | null;
    latest_date: string;
    latest_precision: "day" | "month";
  };
  sales: Sale[];
}

export interface CompsResponse {
  domain: string;
  basis: Sale;
  same_name: Sale[];
  similar_keyword: Sale[];
  similar_length: Sale[];
  nearby_price: Sale[];
}

export interface MetaResponse {
  total: number;
  estimates: number;
  unknown_venues: number;
  date_min: string | null;
  date_max: string | null;
  extensions: { extension: string; count: number }[];
  venues: { venue: string; count: number }[];
  /** When the summary tables were last rebuilt. Null before the first refresh. */
  refreshed_at: string | null;
  /** True when rows have changed since refreshed_at. Search still returns what is loaded. */
  stale: boolean;
}
