import { describe, expect, it } from "vitest";
import { prefixBounds, sldDomainBounds } from "../src/shared/domain";
import { foldStats, interpretCount, statsAreStale } from "../src/shared/stats";
import { resultPages } from "../src/shared/search";

describe("catalog stats", () => {
  it("folds one grouped scan into extension and venue totals", () => {
    const stats = foldStats([
      { extension: ".com", venue: "Sedo", n: 3, estimates: 1, date_min: "2019-04-02", date_max: "2023-08-19", max_id: 20 },
      { extension: ".com", venue: "Unknown", n: 2, estimates: 0, date_min: "2020-01-01", date_max: "2024-05-01", max_id: 40 },
      { extension: ".ai", venue: "Unknown", n: 4, estimates: 2, date_min: "2021-06-12", date_max: "2026-10-22", max_id: 15 },
    ]);
    expect(stats.total).toBe(9);
    expect(stats.estimates).toBe(3);
    expect(stats.unknown_venues).toBe(6);
    expect(stats.date_min).toBe("2019-04-02");
    expect(stats.date_max).toBe("2026-10-22");
    expect(stats.max_id).toBe(40);
    expect(stats.extensions).toEqual([
      { extension: ".com", count: 5 },
      { extension: ".ai", count: 4 },
    ]);
    expect(stats.venues[0]).toEqual({ venue: "Unknown", count: 6 });
  });

  it("treats a later insert as stale and a capped count as inexact", () => {
    expect(statsAreStale({ max_id: 10, date_max: "2026-10-22" }, { max_id: 11, date_max: "2026-10-23" })).toBe(true);
    expect(statsAreStale({ max_id: 10, date_max: "2026-10-22" }, { max_id: 10, date_max: "2026-10-22" })).toBe(false);
    expect(statsAreStale({ max_id: 0, date_max: null }, { max_id: null, date_max: null })).toBe(false);
    expect(interpretCount(12, 500)).toEqual({ total: 12, exact: true });
    expect(interpretCount(501, 500)).toEqual({ total: 500, exact: false });
    expect(resultPages(420, 50)).toBe(9);
    expect(resultPages(226_029, 50)).toBe(41);
  });
});

describe("domain index bounds", () => {
  it("keeps resales and other extensions inside an sld range", () => {
    const bounds = sldDomainBounds("harborlane");
    expect(bounds).toEqual({ low: "harborlane.", high: "harborlane/" });
    for (const domain of ["harborlane.com", "harborlane.co.uk", "harborlane.io"]) {
      expect(domain >= bounds.low && domain < bounds.high).toBe(true);
    }
    expect("harborlaneapp.com" >= bounds.low && "harborlaneapp.com" < bounds.high).toBe(false);
    expect(prefixBounds("ab")).toEqual({ low: "ab", high: "ac" });
    expect("harborlane.com" >= "harbor" && "harborlane.com" < "harbos").toBe(true);
  });
});