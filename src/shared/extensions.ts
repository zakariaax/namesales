export interface ExtensionCount {
  extension: string;
  count: number;
}

export const POPULAR_EXTENSIONS = [".com", ".net", ".org", ".io", ".ai", ".co", ".xyz", ".app"] as const;

/** How many names lead the Popular group, including the list above. */
export const POPULAR_LIMIT = 12;

/** Options mounted at once. The rest stay in memory until the query narrows them. */
export const VISIBLE_EXTENSION_CAP = 30;

const GENERIC = new Set([
  ".com", ".net", ".org", ".info", ".biz", ".name", ".pro", ".mobi", ".asia",
  ".tel", ".xxx", ".jobs", ".travel", ".cat", ".aero", ".museum", ".coop",
  ".int", ".edu", ".gov", ".mil", ".post",
]);

export type ExtensionGroupName = "Popular" | "Generic" | "Country codes" | "New gTLDs";

export interface ExtensionGroup {
  name: ExtensionGroupName;
  items: ExtensionCount[];
}

export interface ExtensionView {
  groups: ExtensionGroup[];
  shown: number;
  totalMatches: number;
}

const GROUP_ORDER: ExtensionGroupName[] = ["Popular", "Generic", "Country codes", "New gTLDs"];

export function arrangeExtensions(rows: ExtensionCount[], query: string): ExtensionView {
  const needle = query.trim().toLowerCase().replace(/^\./, "");
  const matches = rows.filter((row) => {
    if (!needle) return true;
    return row.extension.toLowerCase().replace(/^\./, "").includes(needle);
  });
  const ranked = [...matches].sort(byCount);
  const popular = new Set<string>();
  for (const extension of POPULAR_EXTENSIONS) {
    if (ranked.some((row) => row.extension === extension)) popular.add(extension);
  }
  // A typed query keeps matches in their real group. The unfiltered list
  // also promotes the next-highest counts into Popular.
  if (!needle) {
    for (const row of ranked) {
      if (popular.size >= POPULAR_LIMIT) break;
      popular.add(row.extension);
    }
  }

  const buckets = new Map<ExtensionGroupName, ExtensionCount[]>();
  for (const name of GROUP_ORDER) buckets.set(name, []);
  const popularRows: ExtensionCount[] = [];
  for (const extension of POPULAR_EXTENSIONS) {
    const row = ranked.find((item) => item.extension === extension);
    if (row && popular.has(extension)) popularRows.push(row);
  }
  for (const row of ranked) {
    if (popular.has(row.extension) && !popularRows.some((item) => item.extension === row.extension)) {
      popularRows.push(row);
    }
  }
  buckets.set("Popular", popularRows);
  for (const row of ranked) {
    if (popular.has(row.extension)) continue;
    buckets.get(classifyExtension(row.extension))!.push(row);
  }

  const groups: ExtensionGroup[] = [];
  let shown = 0;
  for (const name of GROUP_ORDER) {
    const items = buckets.get(name) ?? [];
    if (!items.length || shown >= VISIBLE_EXTENSION_CAP) continue;
    const take = items.slice(0, VISIBLE_EXTENSION_CAP - shown);
    groups.push({ name, items: take });
    shown += take.length;
  }
  return { groups, shown, totalMatches: matches.length };
}

export function classifyExtension(extension: string): Exclude<ExtensionGroupName, "Popular"> {
  if (GENERIC.has(extension)) return "Generic";
  const labels = extension.replace(/^\./, "").split(".");
  const last = labels[labels.length - 1] ?? "";
  if (labels.length > 1 || last.length === 2) return "Country codes";
  return "New gTLDs";
}

function byCount(left: ExtensionCount, right: ExtensionCount): number {
  return right.count - left.count || left.extension.localeCompare(right.extension);
}
