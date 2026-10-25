import { describe, expect, it } from "vitest";
import { formatSaleDate } from "../src/shared/dates";
import { formatSalePrice } from "../src/shared/price";

const base = {
  price_usd: 0,
  price_is_estimate: 1,
  price_range: null as string | null,
  price_min_usd: null as number | null,
  price_max_usd: null as number | null,
};

describe("formatSalePrice", () => {
  it("shows an exact dollar amount", () => {
    expect(formatSalePrice({ ...base, price_usd: 18500, price_is_estimate: 0 }).text).toBe("$18,500");
  });

  it("shows <$100 for the zero-dollar under-100 bucket", () => {
    const label = formatSalePrice({
      ...base,
      price_usd: 0,
      price_range: "<100",
      price_min_usd: 0,
      price_max_usd: 99,
    });
    expect(label.text).toBe("<$100");
    expect(label.exact).toBe(false);
  });

  it("shows friendly NameBio buckets instead of the minimum", () => {
    expect(formatSalePrice({ ...base, price_usd: 1000, price_range: "1,000-4,999", price_min_usd: 1000, price_max_usd: 4999 }).text).toBe("$1k–$5k");
    expect(formatSalePrice({ ...base, price_usd: 1000, price_range: "1000-4999", price_min_usd: 1000, price_max_usd: 4999 }).text).toBe("$1k–$5k");
    expect(formatSalePrice({ ...base, price_usd: 100000, price_range: "100,000+", price_min_usd: 100000, price_max_usd: null }).text).toBe("$100k+");
    expect(formatSalePrice({ ...base, price_usd: 100, price_range: "100-999", price_min_usd: 100, price_max_usd: 999 }).text).toBe("$100–$999");
  });
});

describe("formatSaleDate", () => {
  it("hides the placeholder day on month-precision rows", () => {
    expect(formatSaleDate("2026-10-01", "month")).toBe("Oct 2026");
    expect(formatSaleDate("2026-10-01", "day")).toBe("Oct 1, 2026");
  });
});
