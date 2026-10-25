import type { Sale } from "./types";

export interface PriceLabel {
  text: string;
  exact: boolean;
  title: string;
}

/**
 * NameBio range buckets, normalized (no commas, spaces, or currency signs).
 * Display text is the friendly form, never the stored minimum.
 */
const BUCKETS: Record<string, string> = {
  "<100": "<$100",
  "100-999": "$100–$999",
  "1000-4999": "$1k–$5k",
  "5000-9999": "$5k–$10k",
  "10000-24999": "$10k–$25k",
  "25000-49999": "$25k–$50k",
  "50000-99999": "$50k–$100k",
  "100000+": "$100k+",
};

const exactFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function normalizeRange(range: string | null | undefined): string {
  if (!range) return "";
  return range
    .trim()
    .toLowerCase()
    .replace(/[–—−]/g, "-")
    .replace(/[$,\s]/g, "");
}

function compactUsd(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs < 1000) return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
  if (abs < 1_000_000) {
    const k = abs / 1000;
    const rounded = k >= 10 ? Math.round(k) : Math.round(k * 10) / 10;
    return `${sign}$${rounded}k`;
  }
  const m = abs / 1_000_000;
  const rounded = m >= 10 ? Math.round(m) : Math.round(m * 10) / 10;
  return `${sign}$${rounded}M`;
}

function genericRange(min: number | null, max: number | null, priceUsd: number): string {
  const lo = min ?? priceUsd;
  if (max == null) return `${compactUsd(lo)}+`;
  if (lo === 0 && max <= 99) return "<$100";
  return `${compactUsd(lo)}–${compactUsd(max)}`;
}

type PriceFields = Pick<
  Sale,
  "price_usd" | "price_is_estimate" | "price_range" | "price_min_usd" | "price_max_usd"
>;

/** Exact sales show the recorded price. Estimates show the reported bucket. */
export function formatSalePrice(sale: PriceFields): PriceLabel {
  if (!sale.price_is_estimate) {
    return {
      text: exactFormat.format(sale.price_usd),
      exact: true,
      title: "Exact price",
    };
  }

  const key = normalizeRange(sale.price_range);
  const underHundred =
    key === "<100" ||
    (sale.price_usd === 0 && (sale.price_max_usd == null || sale.price_max_usd <= 99));
  const text = underHundred
    ? "<$100"
    : (key && BUCKETS[key]) || genericRange(sale.price_min_usd, sale.price_max_usd, sale.price_usd);

  const raw = sale.price_range ? ` (${sale.price_range})` : "";
  const title = underHundred
    ? "Reported as under $100. The stored minimum is $0, so rankings skip it unless range estimates are included."
    : `Reported range${raw}. Search and sort use the range minimum ($${sale.price_usd.toLocaleString("en-US")}).`;

  return { text, exact: false, title };
}
