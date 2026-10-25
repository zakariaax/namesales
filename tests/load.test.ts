import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../scripts/lib/csv";
import { renderSeedFiles } from "../scripts/lib/chunk";
import { rowsFromCsv } from "../scripts/lib/rows";
import { SALE_COLUMNS } from "../src/shared/types";

describe("schema", () => {
  it("keeps the migration DDL identical to schema.sql", () => {
    const schema = readFileSync("schema.sql", "utf8");
    const migration = readFileSync("migrations/0001_init.sql", "utf8");
    const ddl = schema.slice(schema.indexOf("CREATE TABLE sales")).trim();
    expect(migration.trim().endsWith(ddl)).toBe(true);
    for (const column of ["also_reported_by", "date_precision", "price_is_estimate", "price_min_usd", "is_idn", "tld_levels"]) {
      expect(ddl).toContain(column);
    }
    expect(ddl).toContain("tokenize='trigram'");
    expect(ddl).toContain("CREATE TRIGGER sales_ai");
    expect(schema).not.toMatch(/BEGIN TRANSACTION/);
  });
});

describe("csv and seed chunks", () => {
  it("parses quotes, commas, and escaped quotes", () => {
    const csv = `id,note\n1,"hello, ""world"""\n`;
    expect(parseCsv(csv)[0].record.note).toBe('hello, "world"');
  });

  it("writes chunked inserts without transactions", () => {
    const header = SALE_COLUMNS.join(",");
    const note = "DNJournal's chart, continued";
    const lines = [header];
    for (let id = 1; id <= 800; id++) {
      const cells = [
        id, `name${id}.com`, `name${id}`, ".com", "2024-01-02", "day", 1500, 0, "", "", "",
        "Unknown", "Sample Fixture", "", "", note, "", "", "fixtures/sample-sales.csv",
        4 + String(id).length, 0, 0, 0, 0, 1,
      ];
      lines.push(cells.map((value) => value === note ? `"${note}"` : String(value)).join(","));
    }
    const rows = rowsFromCsv(parseCsv(`${lines.join("\n")}\n`));
    const files = renderSeedFiles(rows, { maxFileBytes: 20_000, maxStatementBytes: 8_000, maxRowsPerStatement: 40 });
    expect(files.length).toBeGreaterThan(1);
    const joined = files.join("\n");
    expect(joined).not.toMatch(/\bBEGIN\b/);
    expect(joined).not.toMatch(/\bCOMMIT\b/);
    expect(joined).toContain("DNJournal''s chart, continued");
    for (const file of files) {
      expect(Buffer.byteLength(file)).toBeLessThanOrEqual(20_000);
      for (const statement of file.split(";").filter((part) => part.includes("INSERT"))) {
        const tuples = statement.split("\n").filter((line) => line.startsWith("(")).length;
        expect(tuples).toBeLessThanOrEqual(40);
        expect(Buffer.byteLength(`${statement};`)).toBeLessThanOrEqual(8_000);
      }
    }
  });
});
