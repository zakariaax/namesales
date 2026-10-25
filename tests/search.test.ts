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

  it("falls back to a prefix match below 3 characters", () => {
    const built = buildSalesQuery(filter("q=ab&match=contains"));
    expect(built.matchApplied).toBe("prefix");
    expect(built.sql).toContain("s.sld LIKE ?");
    expect(built.sql).not.toContain("sales_fts");
    expect(built.binds[0]).toBe("ab%");
    expect(built.notice).toMatch(/shorter than 3/);
  });

  it("keeps starts, ends, and exact on the indexed columns", () => {
    expect(buildSalesQuery(filter("q=harbor&match=starts")).binds[0]).toBe("harbor%");
    expect(buildSalesQuery(filter("q=lane&match=ends")).binds[0]).toBe("%lane");
    const exact = buildSalesQuery(filter("q=harborlane&match=exact"));
    expect(exact.sql).toContain("s.sld = ?");
    expect(exact.binds[0]).toBe("harborlane");
  });

  it("treats a dotted keyword as a domain query", () => {
    const built = buildSalesQuery(filter("q=harborlane.com&match=exact"));
    expect(built.sql).toContain("s.domain = ?");
  });

  it("excludes estimates and month-precision rows when asked", () => {
    const built = buildSalesQuery(filter("estimates=exclude&precision=day&ext=com,ai&venue=Sedo"));
    expect(built.sql).toContain("s.price_is_estimate = 0");
    expect(built.sql).toContain("s.date_precision = 'day'");
    expect(built.sql).toContain("s.extension IN (?, ?)");
    expect(built.binds).toEqual([".com", ".ai", "Sedo", 50, 0]);
  });

  it("rejects sort columns that are not on the whitelist", () => {
    const parsed = parseFilter(new URLSearchParams("sort=price;drop"));
    expect(parsed.ok).toBe(false);
  });

  it("caps LIKE patterns at 50 bytes", () => {
    const keyword = "a".repeat(60);
    const built = buildSalesQuery(filter(`q=${keyword}&match=ends`));
    expect(built.matchApplied).toBe("suffix");
    const pattern = String(built.binds[0]);
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
