import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getJson } from "../api";
import { Filters } from "../components/Filters";
import { Pagination, Results } from "../components/Results";
import { apiUrl, readPage, toggleSort, withFilter, withView, writePage, type PageState } from "../state";
import type { MatchMode } from "../../shared/search";
import type { MetaResponse, SearchResponse } from "../../shared/types";

const MATCHES: { id: MatchMode; label: string }[] = [
  { id: "contains", label: "Contains" },
  { id: "starts", label: "Starts with" },
  { id: "ends", label: "Ends with" },
  { id: "exact", label: "Exact" },
];

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const parsed = readPage(params);
  const [draft, setDraft] = useState(parsed.ok ? parsed.state.filter.q : "");
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(parsed.ok ? null : parsed.message);
  const [loading, setLoading] = useState(parsed.ok);
  const [drawer, setDrawer] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (parsed.ok) setDraft(parsed.state.filter.q);
  }, [parsed.ok, parsed.ok ? parsed.state.filter.q : ""]);

  useEffect(() => {
    const controller = new AbortController();
    getJson<MetaResponse>("/api/meta", controller.signal).then(setMeta).catch(() => undefined);
    return () => controller.abort();
  }, []);

  const query = params.toString();
  useEffect(() => {
    const parsedNow = readPage(new URLSearchParams(query));
    if (!parsedNow.ok) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getJson<SearchResponse>(apiUrl(parsedNow.state), controller.signal)
      .then((payload) => {
        setData(payload);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Search failed.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [query]);

  useEffect(() => {
    const view = parsed.ok ? parsed.state.view : "search";
    const title = view === "top" ? "Top sales" : view === "recent" ? "Recent sales" : "Search";
    document.title = `${title} · NameSales`;
  }, [parsed.ok, parsed.ok ? parsed.state.view : ""]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "/" && !isTyping(event.target)) {
        event.preventDefault();
        document.getElementById("q")?.focus();
      }
      if (event.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = drawer ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawer]);

  const commit = (next: PageState) => {
    const nextParams = writePage(next);
    if (nextParams.toString() === params.toString()) return;
    setParams(nextParams);
  };

  const reset = () => {
    const blank = readPage(new URLSearchParams());
    if (!blank.ok) return;
    setDraft("");
    setDrawer(false);
    commit(blank.state);
  };

  const state = parsed.ok ? parsed.state : null;
  const headline = !state || state.view === "search"
    ? "Search sold domains"
    : state.view === "top"
      ? "Highest recorded prices"
      : `The last ${state.days} days`;
  const lede = !state || state.view === "search"
    ? "Exact prices when a sale was published. Reported ranges when it was not."
    : state.view === "top"
      ? "Exact prices only, unless you include range estimates."
      : "Day-precision sales. Month-only ranges stay out of the window unless you include them.";

  const activeFilters = state ? countFilters(state) : 0;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{headline}</h1>
          <p className="lede">{lede}</p>
        </div>
        {state && (
          <div className="view-switch" role="tablist" aria-label="Result set">
            {(["search", "top", "recent"] as const).map((view) => (
              <button
                key={view}
                type="button"
                role="tab"
                aria-selected={state.view === view}
                className={state.view === view ? "is-on" : undefined}
                onClick={() => commit(withView(state, view))}
              >
                {view === "search" ? "All sales" : view === "top" ? "Top sales" : "Recent"}
              </button>
            ))}
          </div>
        )}
      </div>

      {state && (
        <form
          className="search-form"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            commit(withFilter(state, { q: draft.trim().toLowerCase() }));
          }}
        >
          <div className="search-row">
            <label className="sr-only" htmlFor="q">Keyword</label>
            <input
              id="q"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Search a name, for example harbor"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <button className="primary" type="submit">Search</button>
          </div>
          <div className="match-row">
            <div className="segment" role="group" aria-label="Match mode">
              {MATCHES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={state.filter.match === mode.id ? "is-on" : undefined}
                  aria-pressed={state.filter.match === mode.id}
                  onClick={() => commit(withFilter(state, { match: mode.id }))}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <button type="button" className="filter-toggle" onClick={() => setDrawer(true)} aria-controls="filters" aria-expanded={drawer}>
              Filters{activeFilters > 0 ? ` · ${activeFilters}` : ""}
            </button>
          </div>
          <Filters
            state={state}
            meta={meta}
            open={drawer}
            total={data?.total ?? null}
            onClose={() => setDrawer(false)}
            onChange={commit}
          />
        </form>
      )}
      {drawer && <button type="button" className="backdrop" aria-label="Close filters" onClick={() => setDrawer(false)} />}

      <div className="results-meta">
        <p>
          {data ? (
            <>
              <strong>{data.total.toLocaleString("en-US")}</strong> {data.total === 1 ? "sale" : "sales"}
              <span className="elapsed">{data.elapsed_ms} ms</span>
            </>
          ) : (
            "Looking up sales"
          )}
        </p>
        <div className="meta-actions">
          {state && (
            <label className="page-size">
              <span className="sr-only">Rows per page</span>
              <select
                value={state.filter.pageSize}
                onChange={(event) => commit(withFilter(state, { pageSize: Number(event.target.value) }))}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
          )}
          <button
            type="button"
            className="text-button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1400);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          {state && activeFilters + (state.filter.q ? 1 : 0) > 0 && (
            <button type="button" className="text-button" onClick={reset}>
              Reset
            </button>
          )}
        </div>
      </div>

      {data?.notice && <p className="notice">{data.notice}</p>}
      {data?.window && (
        <p className="notice">
          {data.window.from} to {data.window.to}
          {state?.filter.estimates === "exclude" && " · range estimates hidden"}
          {state?.filter.precision === "day" && " · month-only dates hidden"}
        </p>
      )}
      {error && <p className="banner">{error}</p>}

      <div className={loading ? "results is-loading" : "results"} aria-busy={loading}>
        {data && data.results.length > 0 && state && (
          <Results sales={data.results} sort={state.filter.sort} dir={state.filter.dir} onSort={(sort) => commit(toggleSort(state, sort))} />
        )}
        {data && data.results.length === 0 && !error && (
          <div className="empty">
            <h2>No sales match</h2>
            <p>Widen the price or date range, or include range estimates.</p>
          </div>
        )}
        {!data && !error && <div className="skeleton" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <span key={index} />)}</div>}
      </div>

      {data && state && (
        <Pagination page={data.page} pages={data.pages} onPage={(page) => commit({ ...state, filter: { ...state.filter, page } })} />
      )}
    </main>
  );
}

function countFilters(state: PageState): number {
  const filter = state.filter;
  let count = filter.extensions.length + filter.venues.length;
  if (filter.priceMin != null) count++;
  if (filter.priceMax != null) count++;
  if (state.view !== "recent" && filter.dateFrom) count++;
  if (state.view !== "recent" && filter.dateTo) count++;
  if (filter.lengthMin != null) count++;
  if (filter.lengthMax != null) count++;
  if (filter.digits !== "any") count++;
  if (filter.hyphens !== "any") count++;
  return count;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
