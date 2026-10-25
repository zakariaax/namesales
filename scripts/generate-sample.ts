import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { domainToASCII } from "node:url";
import { SALE_COLUMNS } from "../src/shared/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "fixtures", "sample-sales.csv");

interface Draft {
  sld: string;
  extension: string;
  date: string;
  date_precision: "day" | "month";
  price_usd: number;
  price_is_estimate: number;
  price_range: string | null;
  price_min_usd: number | null;
  price_max_usd: number | null;
  venue: string;
  also_reported_by?: string | null;
  price_note?: string | null;
  original_price?: string | null;
  source_url?: string | null;
}

const BUCKETS: { range: string; min: number; max: number | null; price: number }[] = [
  { range: "<100", min: 0, max: 99, price: 0 },
  { range: "100-999", min: 100, max: 999, price: 100 },
  { range: "1,000-4,999", min: 1000, max: 4999, price: 1000 },
  { range: "5,000-9,999", min: 5000, max: 9999, price: 5000 },
  { range: "10,000-24,999", min: 10000, max: 24999, price: 10000 },
  { range: "25,000-49,999", min: 25000, max: 49999, price: 25000 },
  { range: "50,000-99,999", min: 50000, max: 99999, price: 50000 },
  { range: "100,000+", min: 100000, max: null, price: 100000 },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, weighted: [T, number][]): T {
  const total = weighted.reduce((sum, entry) => sum + entry[1], 0);
  let cursor = rng() * total;
  for (const [value, weight] of weighted) {
    cursor -= weight;
    if (cursor <= 0) return value;
  }
  return weighted[weighted.length - 1][0];
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function randomDate(rng: () => number, start: string, end: string): string {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  const ms = a + Math.floor(rng() * (b - a + 1));
  return new Date(ms).toISOString().slice(0, 10);
}

function exact(sld: string, extension: string, date: string, price: number, venue: string, extra: Partial<Draft> = {}): Draft {
  return {
    sld,
    extension,
    date,
    date_precision: "day",
    price_usd: price,
    price_is_estimate: 0,
    price_range: null,
    price_min_usd: null,
    price_max_usd: null,
    venue,
    ...extra,
  };
}

function estimate(sld: string, extension: string, month: string, bucketIndex: number, venue: string): Draft {
  const bucket = BUCKETS[bucketIndex];
  return {
    sld,
    extension,
    date: `${month}-01`,
    date_precision: "month",
    price_usd: bucket.price,
    price_is_estimate: 1,
    price_range: bucket.range,
    price_min_usd: bucket.min,
    price_max_usd: bucket.max,
    venue,
  };
}

const LEFT = ["amber", "cedar", "cobalt", "ember", "fern", "glen", "harbor", "ivory", "jasper", "kindle", "lunar", "maple", "nova", "olive", "pebble", "quartz", "river", "sage", "timber", "umber", "willow", "yarrow", "bronze", "clover", "drift", "falcon", "honey", "indigo", "kepler", "mosaic"];
const RIGHT = ["path", "field", "lane", "forge", "orbit", "ledger", "pixel", "north", "folio", "spring", "market", "craft", "stone", "bloom", "signal", "garden", "bridge", "works", "studio", "cloud", "base", "line", "point", "wave", "mint", "bay", "hill", "dock", "reef", "vale"];
const EXTS: [string, number][] = [[".com", 50], [".ai", 14], [".net", 8], [".org", 6], [".io", 6], [".co", 4], [".co.uk", 4], [".de", 3], [".app", 3], [".xyz", 2]];
const VENUES: [string, number][] = [["Unknown", 50], ["Sedo", 18], ["Afternic", 8], ["GoDaddy", 7], ["SnapNames", 5], ["NameJet", 4], ["Moniker", 3], ["Private", 3], ["DomainNameSales", 1], ["Uniregistry", 1]];

const idnSld = domainToASCII("样例.com").replace(/\.com$/, "");

const featured: Draft[] = [
  exact("harborlane", ".com", "2026-10-22", 48500, "Sedo", {
    also_reported_by: "NameBio (sample re-mention)",
  }),
  exact("cedarfolio", ".com", "2026-10-21", 1_250_000, "GoDaddy"),
  exact("quietledger", ".com", "2026-10-20", 9400, "Unknown"),
  exact("paperorchard", ".ai", "2026-10-18", 64000, "Afternic"),
  exact("novastack", ".io", "2026-10-17", 8200, "NameJet"),
  exact("silverferry", ".co.uk", "2026-10-16", 15750, "Private"),
  exact("41827", ".com", "2026-10-15", 6100, "SnapNames"),
  exact("blue-harbor", ".com", "2026-10-14", 22000, "Sedo"),
  exact("kindlepath", ".com", "2026-10-13", 12800, "Unknown", {
    also_reported_by: "DomainGang's weekly (sample)",
  }),
  exact("embermarket", ".com", "2026-10-12", 11000, "Sedo", {
    price_note: "Sample note: converted from EUR at a made-up rate",
    original_price: "EUR 10,000",
    source_url: "https://example.com/namesales-sample",
  }),
  exact("mosaicreef", ".net", "2026-10-11", 2750, "GoDaddy"),
  exact("willowmint", ".org", "2026-10-11", 1900, "Unknown"),
  exact("quartzledger", ".com", "2026-10-23", 640_000, "Afternic"),
  exact("falconbase", ".ai", "2026-10-19", 88000, "Sedo"),
  exact("olive-point", ".com", "2026-10-18", 5400, "Moniker"),
  exact("riverdock", ".de", "2026-10-17", 3200, "Unknown"),
  exact("cloverstudio", ".com", "2026-10-16", 41000, "GoDaddy"),
  exact("indigo-bay", ".co", "2026-10-13", 7300, "Dynadot"),
  estimate("lowsample", ".net", "2026-10", 0, "Unknown"),
  estimate("amberrange", ".io", "2026-10", 2, "Sedo"),
  estimate("mossbucket", ".com", "2026-10", 1, "Unknown"),
  estimate("peakrange", ".ai", "2026-10", 4, "Afternic"),
  estimate("vastrange", ".com", "2026-10", 7, "GoDaddy"),
  estimate("softbin", ".org", "2026-10", 3, "Unknown"),
  exact("harborlane", ".io", "2025-08-02", 9800, "Afternic"),
  estimate("harborlane", ".net", "2025-11", 2, "Unknown"),
  exact("harborlane", ".ai", "2026-04-18", 27000, "Private"),
  exact("harborlane", ".co.uk", "2023-01-09", 3400, "NameJet"),
  exact("harborlane", ".com", "2024-11-03", 18500, "Sedo"),
  exact("harborlane", ".com", "2021-06-12", 4200, "GoDaddy"),
  exact("myharborlane", ".com", "2025-02-11", 2150, "Unknown"),
  exact("harborlaneapp", ".com", "2024-07-22", 1900, "Sedo"),
  exact("harbor-lane", ".com", "2022-05-16", 6600, "GoDaddy"),
  exact("northharbor", ".com", "2025-12-02", 14200, "Unknown"),
  exact(idnSld, ".com", "2024-03-08", 2500, "Sedo"),
  exact("sample-ledger", ".com", "2022-09-30", 36000, "Sedo"),
  exact("sample-ledger", ".com", "2026-09-20", 51000, "Afternic"),
];

function roundPrice(rng: () => number): number {
  const roll = rng();
  const raw = roll < 0.55
    ? 100 + Math.floor(rng() * 4900)
    : roll < 0.85
      ? 5000 + Math.floor(rng() * 45000)
      : roll < 0.97
        ? 50000 + Math.floor(rng() * 200000)
        : 250000 + Math.floor(rng() * 500000);
  return Math.max(100, Math.round(raw / 50) * 50);
}

function build(): Draft[] {
  const rng = mulberry32(20261025);
  const used = new Set(featured.map((row) => `${row.sld}${row.extension}|${row.date}|${row.price_usd}`));
  const rows = [...featured];
  let guard = 0;
  while (rows.length < 420 && guard < 5000) {
    guard++;
    const left = LEFT[Math.floor(rng() * LEFT.length)];
    const right = RIGHT[Math.floor(rng() * RIGHT.length)];
    let sld = `${left}${right}`;
    const roll = rng();
    if (roll < 0.08) sld = `${left}-${right}`;
    else if (roll < 0.14) sld = `${left}${1 + Math.floor(rng() * 99)}`;
    else if (roll < 0.17) sld = String(1000 + Math.floor(rng() * 90000));
    const extension = pick(rng, EXTS);
    const venue = pick(rng, VENUES);
    const recent = rows.length < featured.length + 28;
    const date = recent ? randomDate(rng, "2026-08-01", "2026-10-10") : randomDate(rng, "2008-01-01", "2026-07-31");
    const makeEstimate = rng() < 0.16;
    const draft = makeEstimate
      ? estimate(sld, extension, date.slice(0, 7), Math.floor(rng() * BUCKETS.length), venue)
      : exact(sld, extension, date, roundPrice(rng), venue);
    // Identity includes the date. A later sale of the same domain is a resale and is kept.
    const key = `${draft.sld}${draft.extension}|${draft.date}|${draft.price_usd}|${draft.price_is_estimate}`;
    if (used.has(key)) continue;
    used.add(key);
    rows.push(draft);
  }
  return rows;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function flags(sld: string, extension: string) {
  return {
    length: sld.length,
    has_hyphen: sld.includes("-") ? 1 : 0,
    has_digit: /\d/.test(sld) ? 1 : 0,
    is_numeric: /^\d+$/.test(sld) ? 1 : 0,
    is_idn: sld.startsWith("xn--") ? 1 : 0,
    tld_levels: extension.slice(1).split(".").filter(Boolean).length,
  };
}

const drafts = build().sort((a, b) => {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.price_usd !== b.price_usd) return b.price_usd - a.price_usd;
  return a.sld.localeCompare(b.sld);
});

const lines = [SALE_COLUMNS.join(",")];
drafts.forEach((draft, index) => {
  const derived = flags(draft.sld, draft.extension);
  const record: Record<string, string | number | null> = {
    id: index + 1,
    domain: `${draft.sld}${draft.extension}`,
    sld: draft.sld,
    extension: draft.extension,
    date: draft.date,
    date_precision: draft.date_precision,
    price_usd: draft.price_usd,
    price_is_estimate: draft.price_is_estimate,
    price_range: draft.price_range,
    price_min_usd: draft.price_min_usd,
    price_max_usd: draft.price_max_usd,
    venue: draft.venue,
    source: "Sample Fixture",
    source_original: "sample-fixture",
    source_url: draft.source_url ?? null,
    also_reported_by: draft.also_reported_by ?? null,
    price_note: draft.price_note ?? null,
    original_price: draft.original_price ?? null,
    origin_file: "fixtures/sample-sales.csv",
    ...derived,
  };
  const cells = SALE_COLUMNS.map((column) => {
    const value = record[column];
    if (value == null) return "";
    return typeof value === "number" ? String(value) : csvEscape(value);
  });
  lines.push(cells.join(","));
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${lines.join("\n")}\n`);
console.log(`Wrote ${drafts.length} synthetic sales to ${outPath}`);
