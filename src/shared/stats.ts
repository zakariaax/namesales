/** One GROUP BY extension, venue folded into catalog totals. */
export interface StatsGroup {
  extension: string;
  venue: string;
  n: number;
  estimates: number;
  date_min: string | null;
  date_max: string | null;
  max_id: number;
}

export interface CatalogStats {
  total: number;
  estimates: number;
  unknown_venues: number;
  date_min: string | null;
  date_max: string | null;
  max_id: number;
  extensions: { extension: string; count: number }[];
  venues: { venue: string; count: number }[];
}

export function foldStats(groups: StatsGroup[]): CatalogStats {
  const extensions = new Map<string, number>();
  const venues = new Map<string, number>();
  let total = 0;
  let estimates = 0;
  let unknown = 0;
  let dateMin: string | null = null;
  let dateMax: string | null = null;
  let maxId = 0;

  for (const group of groups) {
    total += group.n;
    estimates += group.estimates;
    if (group.venue === "Unknown") unknown += group.n;
    extensions.set(group.extension, (extensions.get(group.extension) ?? 0) + group.n);
    venues.set(group.venue, (venues.get(group.venue) ?? 0) + group.n);
    if (group.date_min && (dateMin == null || group.date_min < dateMin)) dateMin = group.date_min;
    if (group.date_max && (dateMax == null || group.date_max > dateMax)) dateMax = group.date_max;
    if (group.max_id > maxId) maxId = group.max_id;
  }

  const byCount = (left: { count: number; name: string }, right: { count: number; name: string }) =>
    right.count - left.count || left.name.localeCompare(right.name);

  return {
    total,
    estimates,
    unknown_venues: unknown,
    date_min: dateMin,
    date_max: dateMax,
    max_id: maxId,
    extensions: [...extensions.entries()]
      .map(([extension, count]) => ({ extension, count }))
      .sort((left, right) => byCount({ count: left.count, name: left.extension }, { count: right.count, name: right.extension })),
    venues: [...venues.entries()]
      .map(([venue, count]) => ({ venue, count }))
      .sort((left, right) => byCount({ count: left.count, name: left.venue }, { count: right.count, name: right.venue })),
  };
}

/** D1 rejects a statement with more than this many bound parameters. */
export const D1_MAX_SQL_VARIABLES = 100;

/** Public and automatic rebuilds wait this long after the previous one. */
export const PUBLIC_REBUILD_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type RebuildMode = "auto" | "public" | "forced";

/**
 * `forced` is the admin key or the nightly cron. `auto` is a normal page load.
 * `public` is `?refresh=1` without the key. Both of those run at most once a day,
 * and only `auto`/`public` are skipped when a summary was stored recently.
 */
export function shouldRebuild(mode: RebuildMode, refreshedAt: string | null, now: number): boolean {
  if (mode === "forced") return true;
  if (!refreshedAt) return true;
  const then = Date.parse(refreshedAt);
  if (Number.isNaN(then)) return true;
  return now - then >= PUBLIC_REBUILD_INTERVAL_MS;
}

/** True when rows have been inserted or removed since the summary was stored. */
export function statsAreStale(
  stored: { max_id: number; date_max: string | null },
  probe: { max_id: number | null; date_max: string | null },
): boolean {
  return stored.max_id !== (probe.max_id ?? 0) || (stored.date_max ?? null) !== (probe.date_max ?? null);
}

export function interpretCount(count: number, cap: number): { total: number; exact: boolean } {
  if (count > cap) return { total: cap, exact: false };
  return { total: count, exact: true };
}
