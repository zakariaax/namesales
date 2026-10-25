export interface CsvRow {
  line: number;
  record: Record<string, string>;
}

/** RFC 4180-ish parser. Blank lines are skipped. A leading BOM is ignored. */
export function parseCsv(text: string): CsvRow[] {
  const src = text.replace(/^\uFEFF/, "");
  const table: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let fieldLine = 1;

  const pushField = () => {
    cells.push(field);
    field = "";
  };
  const pushRow = () => {
    if (cells.length === 1 && cells[0] === "") {
      cells = [];
      return;
    }
    table.push({ line: fieldLine, cells });
    cells = [];
  };

  for (let i = 0; i < src.length; i++) {
    const char = src[i];
    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") line++;
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      pushField();
      continue;
    }
    if (char === "\n" || char === "\r") {
      pushField();
      pushRow();
      if (char === "\r" && src[i + 1] === "\n") i++;
      line++;
      fieldLine = line;
      continue;
    }
    field += char;
  }
  if (inQuotes) throw new Error(`CSV quote was not closed (line ${fieldLine}).`);
  if (field.length > 0 || cells.length > 0) {
    pushField();
    pushRow();
  }
  if (!table.length) throw new Error("CSV is empty.");

  const header = table[0].cells.map((name) => name.trim());
  if (new Set(header).size !== header.length) throw new Error("CSV header has a duplicate column.");
  const rows: CsvRow[] = [];
  for (const entry of table.slice(1)) {
    if (entry.cells.length === 1 && entry.cells[0].trim().startsWith("#")) continue;
    if (entry.cells.length !== header.length) {
      throw new Error(`Line ${entry.line} has ${entry.cells.length} columns; the header has ${header.length}.`);
    }
    const record: Record<string, string> = {};
    header.forEach((name, index) => {
      record[name] = entry.cells[index] ?? "";
    });
    rows.push({ line: entry.line, record });
  }
  return rows;
}
