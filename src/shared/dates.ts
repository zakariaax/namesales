const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const monthFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function parseIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function isIsoDate(iso: string): boolean {
  return parseIsoDate(iso) !== null;
}

export function todayUtc(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addUtcDays(iso: string, days: number): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) throw new Error(`Invalid date: ${iso}`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Month-precision rows are stored as the 1st. Show the month, not a fake day. */
export function formatSaleDate(iso: string, precision: string): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return iso;
  if (precision === "month") return monthFormat.format(parsed);
  return dayFormat.format(parsed);
}
