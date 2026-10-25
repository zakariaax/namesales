import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../scripts/lib/csv";
import { renderSeedFiles } from "../scripts/lib/chunk";
import { rowsFromCsv } from "../scripts/lib/rows";
import { DOMAIN_SALES_SQL } from "../src/worker/db";
import { SALE_COLUMNS, type Sale } from "../src/shared/types";

describe("resales", () => {
  it("does not put a unique constraint on domain", () => {
    const schema = readFileSync("schema.sql", "utf8");
    const migration = readFileSync("migrations/0001_init.sql", "utf8");
    for (const sql of [schema, migration]) {
      expect(sql).not.toMatch(/\bUNIQUE\b/);
      expect(sql).toContain("CREATE INDEX idx_sales_domain");
    }
  });

  it("loads every resale of a domain", () => {
    expect(DOMAIN_SALES_SQL).not.toMatch(/DISTINCT|GROUP BY|LIMIT/i);
    expect(DOMAIN_SALES_SQL).toContain("ORDER BY date DESC");

    const header = SALE_COLUMNS.join(",");
    const sale = (id: number, date: string, price: number) =>
      [id, "resale.com", "resale", ".com", date, "day", price, 0, "", "", "", "Sedo", "Sample Fixture", "", "", "", "", "", "fixture", 6, 0, 0, 0, 0, 1].join(",");
    const rows = rowsFromCsv(parseCsv(`${header}\n${sale(1, "2019-04-02", 4000)}\n${sale(2, "2023-08-19", 22000)}\n`));
    expect(rows).toHaveLength(2);
    const sql = renderSeedFiles(rows).join("\n");
    expect(sql).toContain("'resale.com'");
    expect(sql.match(/'resale.com'/g)?.length).toBe(2);
  });

  it("keeps the sample resales of harborlane.com", () => {
    const rows = parseCsv(readFileSync("fixtures/sample-sales.csv", "utf8"));
    const sales = rows.filter((row) => row.record.domain === "harborlane.com");
    const dates = new Set(sales.map((row) => row.record.date));
    expect(dates.has("2021-06-12")).toBe(true);
    expect(dates.has("2026-10-22")).toBe(true);
    expect(sales.length).toBeGreaterThanOrEqual(3);
  });
});

function chartOrder(sales: Pick<Sale, "id" | "date" | "domain">[]): string[] {
  return [...sales]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
    .map((sale) => `${sale.domain}@${sale.date}`);
}

describe("chart order", () => {
  it("plots both dates of one domain", () => {
    expect(chartOrder([
      { id: 2, date: "2023-08-19", domain: "resale.com" },
      { id: 1, date: "2019-04-02", domain: "resale.com" },
    ])).toEqual(["resale.com@2019-04-02", "resale.com@2023-08-19"]);
  });
});
