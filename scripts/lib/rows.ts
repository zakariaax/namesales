import { SALE_COLUMNS, type SaleColumn } from "../../src/shared/types";
import type { CsvRow } from "./csv";
import type { NormalizedSale } from "./chunk";

const REQUIRED: SaleColumn[] = [
  "id",
  "domain",
  "sld",
  "extension",
  "date",
  "date_precision",
  "price_usd",
  "price_is_estimate",
  "venue",
  "source",
  "length",
  "has_hyphen",
  "has_digit",
  "is_numeric",
  "is_idn",
  "tld_levels",
];

export function rowsFromCsv(rows: CsvRow[]): NormalizedSale[] {
  if (!rows.length) throw new Error("CSV has a header but no sales.");
  const header = Object.keys(rows[0].record);
  const missing = SALE_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length) throw new Error(`CSV is missing columns: ${missing.join(", ")}`);

  return rows.map(({ line, record }) => {
    try {
      return normalizeRecord(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid row.";
      throw new Error(`Line ${line}: ${message}`);
    }
  });
}

function normalizeRecord(record: Record<string, string>): NormalizedSale {
  const row: NormalizedSale = {};
  for (const column of SALE_COLUMNS) {
    const raw = (record[column] ?? "").trim();
    if (!raw) {
      if (REQUIRED.includes(column)) {
        if (column === "venue") {
          row[column] = "Unknown";
          continue;
        }
        throw new Error(`${column} is empty.`);
      }
      row[column] = null;
      continue;
    }
    if (column === "price_usd" || column === "price_min_usd" || column === "price_max_usd" || column === "id" || column === "length" || column === "tld_levels") {
      row[column] = strictInt(raw, column);
      continue;
    }
    if (column === "price_is_estimate" || column === "has_hyphen" || column === "has_digit" || column === "is_numeric" || column === "is_idn") {
      row[column] = bit(raw, column);
      continue;
    }
    row[column] = raw;
  }

  const precision = row.date_precision;
  if (precision !== "day" && precision !== "month") {
    throw new Error("date_precision must be day or month.");
  }
  if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
    throw new Error("date must be YYYY-MM-DD.");
  }
  if (typeof row.domain !== "string" || !row.domain.includes(".")) throw new Error("domain is invalid.");
  return row;
}

function strictInt(raw: string, column: string): number {
  if (!/^-?\d+$/.test(raw)) throw new Error(`${column} must be an integer.`);
  return Number(raw);
}

function bit(raw: string, column: string): number {
  const value = raw.toLowerCase();
  if (value === "1" || value === "true" || value === "yes") return 1;
  if (value === "0" || value === "false" || value === "no") return 0;
  throw new Error(`${column} must be 0 or 1.`);
}
