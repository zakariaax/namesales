import { describe, expect, it } from "vitest";
import { buildSalesQuery, parseFilter, recentWindow } from "../src/shared/search";

function filter(query: string) {
  const parsed = parseFilter(new URLSearchParams(query));
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.filter;
}

describe("search sql", () => {
  it("uses FTS for a keyword of 3 or more characters", () => {
    const built = buildSalesQuery(filter("q=crypto&match=contains"));
    expect(built.matchApplied).toBe("fts");
    expect(built.sql).toContain("sales_fts MATCH ?");
    expect(built.binds[0]).toBe('"crypto"');
    expect(built.sql).not.toContain("LIKE");
  });

  it("does not scan for a contains shorter than 3 characters", () => {
    const built = buildSalesQuery(filter("q=ai&match=contains"));
    expect(built.skipped).toBe(true);
    expect(built.matchApplied).toBe("none");
    expect(built.sql).toContain("WHERE 0");
    expect(built.sql).not.toContain("idx_sales_date");
    expect(built.sql).not.toContain("sales_fts");
    expect(built.notice).toMatch(/at least 3 characters/);
  });

  it("uses the domain index for a short starts-with or exact name", () => {
    const starts = buildSalesQuery(filter("q=ai&match=starts"));
    expect(starts.skipped).toBe(false);
    expect(starts.access).toBe("domain");
    expect(starts.sql).toContain("INDEXED BY idx_sales_domain");
    expect(starts.binds.slice(0, 2)).toEqual(["ai", "aj"]);
    const exact = buildSalesQuery(filter("q=ai&match=exact"));
    expect(exact.access).toBe("domain");
    expect(exact.binds.slice(0, 2)).toEqual(["ai.", "ai/"]);
  });

  it("allows a short contains when an extension or date window narrows it", () => {
    const extension = buildSalesQuery(filter("q=ai&match=contains&ext=ai"));
    expect(extension.skipped).toBe(false);
    expect(extension.access).toBe("domain");
    expect(extension.sql).toContain("INDEXED BY idx_sales_domain");
    expect(extension.sql).toContain("s.extension IN (?)");
    const dated = buildSalesQuery(filter("q=ai&match=contains&date_from=2026-09-25&date_to=2026-10-25"));
    expect(dated.skipped).toBe(false);
    expect(dated.access).toBe("date");
    expect(dated.sql).toContain("s.date >= ?");
    expect(dated.sql).toContain("s.date <= ?");
  });

  it("uses the domain index for starts and exact names, and FTS for ends", () => {
    const starts = buildSalesQuery(filter("q=harbor&match=starts"));
    expect(starts.access).toBe("domain");
    expect(starts.sql).toContain("INDEXED BY idx_sales_domain");
    expect(starts.binds.slice(0, 2)).toEqual(["harbor", "harbos"]);
    const ends = buildSalesQuery(filter("q=lane&match=ends"));
    expect(ends.access).toBe("fts");
    expect(ends.binds[0]).toBe('"lane"');
    expect(ends.binds[1]).toBe("%lane");
    const exact = buildSalesQuery(filter("q=harborlane&match=exact"));
    expect(exact.access).toBe("domain");
    expect(exact.sql).toContain("s.domain >= ? AND s.domain < ?");
    expect(exact.binds.slice(0, 2)).toEqual(["harborlane.", "harborlane/"]);
  });

  it("treats a dotted keyword as a domain query", () => {
    const built = buildSalesQuery(filter("q=harborlane.com&match=exact"));
    expect(built.sql).toContain("s.domain = ?");
  });

  it("excludes estimates and month-precision rows when asked", () => {
    const built = buildSalesQuery(filter("estimates=exclude&precision=day&ext=com,ai&venue=Sedo"));
    expect(built.access).toBe("date");
    expect(built.sql).toContain("INDEXED BY idx_sales_date");
    expect(built.sql).toContain("s.price_is_estimate = 0");
    expect(built.sql).toContain("s.date_precision = 'day'");
    expect(built.sql).toContain("s.extension IN (?, ?)");
    expect(built.sql).toContain("s.venue IN (?)");
    expect(built.binds).toEqual([".com", ".ai", "Sedo", 50, 0]);
    expect(built.countSql).toContain("LIMIT 501");
    expect(built.countSql).not.toContain("COUNT(*) AS n FROM sales");
  });

  it("sorts prices on the price indexes and caps an unfiltered count", () => {
    const prices = buildSalesQuery(filter("sort=price&dir=desc"));
    expect(prices.access).toBe("price");
    expect(prices.sql).toContain("INDEXED BY idx_sales_price");
    expect(prices.sql).toContain("LIMIT ? OFFSET ?");
    const extensionPrices = buildSalesQuery(filter("sort=price&ext=com"));
    expect(extensionPrices.access).toBe("ext_price");
    expect(extensionPrices.sql).toContain("INDEXED BY idx_sales_ext_price");
    const home = buildSalesQuery(filter(""));
    expect(home.access).toBe("date");
    expect(home.useCatalogTotal).toBe(true);
    expect(home.countSql).toContain("LIMIT 501");
  });

  it("applies length, hyphen, and digit filters on the date index", () => {
    const built = buildSalesQuery(filter("length_min=4&length_max=8&hyphens=exclude&digits=only"));
    expect(built.access).toBe("date");
    expect(built.sql).toContain("s.length >= ?");
    expect(built.sql).toContain("s.length <= ?");
    expect(built.sql).toContain("s.has_hyphen = 0");
    expect(built.sql).toContain("s.has_digit = 1");
    expect(built.sql).not.toContain("idx_sales_length");
    expect(built.sql).not.toContain("idx_sales_venue");
  });

  it("refuses an unfiltered length sort that would read every row", () => {
    const built = buildSalesQuery(filter("sort=length"));
    expect(built.access).toBe("date");
    expect(built.sql).toContain("s.date DESC");
    expect(built.sql).not.toContain("s.length");
    expect(built.notice).toMatch(/Length sort/);
    const narrowed = buildSalesQuery(filter("q=crypto&sort=length"));
    expect(narrowed.access).toBe("fts");
    expect(narrowed.sql).toContain("s.length DESC");
  });

  it("rejects sort columns that are not on the whitelist", () => {
    const parsed = parseFilter(new URLSearchParams("sort=price;drop"));
    expect(parsed.ok).toBe(false);
  });

  it("caps LIKE patterns at 50 bytes", () => {
    const keyword = "a".repeat(60);
    const built = buildSalesQuery(filter(`q=${keyword}&match=ends`));
    expect(built.matchApplied).toBe("suffix");
    const pattern = String(built.binds.find((bind) => String(bind).includes("%")));
    expect(new TextEncoder().encode(pattern).length).toBeLessThanOrEqual(50);
    expect(built.notice).toMatch(/50-byte/);
  });
});

describe("recent window", () => {
  it("matches the prepared dataset's last-30-days example", () => {
    expect(recentWindow(30, "2026-10-25")).toEqual({
      from: "2026-09-25",
      to: "2026-10-25",
      days: 30,
    });
  });
});
