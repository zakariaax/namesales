import {
  filterToParams,
  parseFilter,
  readDays,
  readView,
  viewDefaults,
  type SalesFilter,
  type SortDir,
  type SortKey,
  type ViewMode,
} from "../shared/search";

export interface PageState {
  view: ViewMode;
  days: number;
  filter: SalesFilter;
}

export function readPage(params: URLSearchParams): { ok: true; state: PageState } | { ok: false; message: string } {
  const view = readView(params);
  const parsed = parseFilter(params, viewDefaults(view));
  if (!parsed.ok) return parsed;
  return { ok: true, state: { view, days: readDays(params), filter: parsed.filter } };
}

export function writePage(state: PageState): URLSearchParams {
  const params = filterToParams(state.filter);
  const defaults = viewDefaults(state.view);
  if (state.filter.estimates === (defaults.estimates ?? "include")) params.delete("estimates");
  if (state.filter.precision === (defaults.precision ?? "any")) params.delete("precision");
  if (state.filter.sort === (defaults.sort ?? "date")) params.delete("sort");
  if (state.filter.dir === (defaults.dir ?? "desc")) params.delete("dir");
  if (state.view !== "search") params.set("view", state.view);
  if (state.view === "recent") {
    params.set("days", String(state.days));
    params.delete("date_from");
    params.delete("date_to");
  }
  return params;
}

export function apiUrl(state: PageState): string {
  const params = filterToParams(state.filter);
  if (state.view === "recent") {
    params.delete("date_from");
    params.delete("date_to");
    params.set("days", String(state.days));
    return `/api/feeds/recent?${params}`;
  }
  if (state.view === "top") return `/api/feeds/top?${params}`;
  return `/api/search?${params}`;
}

export function withFilter(state: PageState, patch: Partial<SalesFilter>): PageState {
  return { ...state, filter: { ...state.filter, page: 1, ...patch } };
}

export function withView(state: PageState, view: ViewMode): PageState {
  const defaults = viewDefaults(view);
  return {
    view,
    days: state.days || 30,
    filter: {
      ...state.filter,
      estimates: defaults.estimates ?? "include",
      precision: defaults.precision ?? "any",
      sort: defaults.sort ?? "date",
      dir: defaults.dir ?? "desc",
      page: 1,
      dateFrom: view === "search" ? state.filter.dateFrom : null,
      dateTo: view === "search" ? state.filter.dateTo : null,
    },
  };
}

export function toggleSort(state: PageState, sort: SortKey): PageState {
  let dir: SortDir;
  if (state.filter.sort === sort) dir = state.filter.dir === "desc" ? "asc" : "desc";
  else dir = sort === "domain" || sort === "length" ? "asc" : "desc";
  return withFilter(state, { sort, dir });
}
