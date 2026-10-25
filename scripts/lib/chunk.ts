import { INT_COLUMNS, SALE_COLUMNS, type SaleColumn } from "../../src/shared/types";

export interface ChunkOptions {
  maxStatementBytes?: number;
  maxRowsPerStatement?: number;
  maxFileBytes?: number;
}

export interface NormalizedSale {
  [key: string]: string | number | null;
}

const DEFAULTS = {
  maxStatementBytes: 90_000,
  maxRowsPerStatement: 500,
  maxFileBytes: 4_500_000,
};

/**
 * Multi-row INSERT files shaped like the prepared seed chunks:
 * each statement is at most 500 rows and 90 KB, files stay under 4.5 MB,
 * and there is no BEGIN/COMMIT (D1 rejects explicit transactions).
 */
export function renderSeedFiles(rows: NormalizedSale[], options: ChunkOptions = {}): string[] {
  const maxStatementBytes = options.maxStatementBytes ?? DEFAULTS.maxStatementBytes;
  const maxRows = options.maxRowsPerStatement ?? DEFAULTS.maxRowsPerStatement;
  const maxFileBytes = options.maxFileBytes ?? DEFAULTS.maxFileBytes;
  const header = `INSERT INTO sales (${SALE_COLUMNS.join(", ")}) VALUES\n`;

  const files: string[] = [];
  let file = "";
  let statementRows: string[] = [];
  let statementBytes = byteLength(header);

  const flushStatement = () => {
    if (!statementRows.length) return;
    const statement = `${header}${statementRows.join(",\n")};\n`;
    if (byteLength(statement) > maxStatementBytes) {
      throw new Error(`A single sales row exceeds the ${maxStatementBytes}-byte statement limit.`);
    }
    if (byteLength(file) + byteLength(statement) > maxFileBytes && file) {
      files.push(file);
      file = "";
    }
    file += statement;
    statementRows = [];
    statementBytes = byteLength(header);
  };

  for (const row of rows) {
    const rendered = renderTuple(row);
    const addition = byteLength(rendered) + 2;
    if (statementRows.length > 0 && (statementRows.length >= maxRows || statementBytes + addition > maxStatementBytes)) {
      flushStatement();
    }
    statementRows.push(rendered);
    statementBytes += addition;
  }
  flushStatement();
  if (file) files.push(file);
  return files;
}

export function renderTuple(row: NormalizedSale): string {
  const values = SALE_COLUMNS.map((column) => sqlLiteral(column, row[column] ?? null));
  return `(${values.join(", ")})`;
}

function sqlLiteral(column: SaleColumn, value: string | number | null): string {
  if (value == null || value === "") {
    if (column === "venue") return "'Unknown'";
    if (INT_COLUMNS.has(column) && column !== "price_min_usd" && column !== "price_max_usd") {
      throw new Error(`${column} is required.`);
    }
    return "NULL";
  }
  if (INT_COLUMNS.has(column)) {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new Error(`${column} must be an integer.`);
    }
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value);
}

export const POST_LOAD_SQL = `INSERT INTO sales_fts(sales_fts) VALUES('optimize');\nANALYZE;\n`;
