import { useEffect, useMemo, useState } from "react";
import type { MetaResponse } from "../../shared/types";
import type { PageState } from "../state";
import { withFilter } from "../state";

const DAY_CHOICES = [7, 30, 90, 365];

export function Filters({
  state,
  meta,
  open,
  total,
  onClose,
  onChange,
}: {
  state: PageState;
  meta: MetaResponse | null;
  open: boolean;
  total: number | null;
  onClose: () => void;
  onChange: (next: PageState) => void;
}) {
  const filter = state.filter;
  const extensions = meta?.extensions ?? [];
  const chips = extensions.slice(0, 8);
  const venues = useMemo(() => {
    const list = [...(meta?.venues ?? [])];
    list.sort((a, b) => {
      if (a.venue === "Unknown") return 1;
      if (b.venue === "Unknown") return -1;
      return b.count - a.count;
    });
    return list;
  }, [meta]);

  const patch = (partial: Parameters<typeof withFilter>[1]) => onChange(withFilter(state, partial));

  return (
    <div className={open ? "filter-panel open" : "filter-panel"} id="filters">
      <div className="drawer-head">
        <strong>{total == null ? "Filters" : `${total.toLocaleString("en-US")} sales`}</strong>
        <button type="button" className="text-button" onClick={onClose}>Done</button>
      </div>

      <div className="chips" role="group" aria-label="Extensions">
        {chips.map((item) => {
          const active = filter.extensions.includes(item.extension);
          return (
            <button
              key={item.extension}
              type="button"
              className={active ? "chip is-on" : "chip"}
              aria-pressed={active}
              onClick={() => patch({ extensions: toggleValue(filter.extensions, item.extension) })}
            >
              {item.extension}
            </button>
          );
        })}
        {extensions.length > chips.length && (
          <ExtensionMenu
            extensions={extensions}
            selected={filter.extensions}
            onChange={(next) => patch({ extensions: next })}
          />
        )}
      </div>

      <div className="filter-grid">
        <NumberField label="Min price" value={filter.priceMin} onCommit={(priceMin) => patch({ priceMin })} prefix="$" />
        <NumberField label="Max price" value={filter.priceMax} onCommit={(priceMax) => patch({ priceMax })} prefix="$" />
        {state.view === "recent" ? (
          <fieldset className="span-2">
            <legend>Window</legend>
            <div className="segment" role="group" aria-label="How many days">
              {DAY_CHOICES.map((days) => (
                <button
                  key={days}
                  type="button"
                  className={state.days === days ? "is-on" : undefined}
                  aria-pressed={state.days === days}
                  onClick={() => onChange({ ...state, days, filter: { ...state.filter, page: 1 } })}
                >
                  {days}d
                </button>
              ))}
            </div>
          </fieldset>
        ) : (
          <>
            <DateField label="From" value={filter.dateFrom} onChange={(dateFrom) => patch({ dateFrom })} />
            <DateField label="To" value={filter.dateTo} onChange={(dateTo) => patch({ dateTo })} />
          </>
        )}
        <NumberField label="Min length" value={filter.lengthMin} onCommit={(lengthMin) => patch({ lengthMin })} />
        <NumberField label="Max length" value={filter.lengthMax} onCommit={(lengthMax) => patch({ lengthMax })} />
        <TriField label="Numbers" value={filter.digits} onChange={(digits) => patch({ digits })} />
        <TriField label="Hyphens" value={filter.hyphens} onChange={(hyphens) => patch({ hyphens })} />
      </div>

      <div className="filter-row">
        <VenueMenu venues={venues} selected={filter.venues} onChange={(next) => patch({ venues: next })} />
        <label className="check">
          <input
            type="checkbox"
            checked={filter.estimates === "include"}
            onChange={(event) => patch({ estimates: event.target.checked ? "include" : "exclude" })}
          />
          Include range estimates
        </label>
        {state.view === "recent" && (
          <label className="check">
            <input
              type="checkbox"
              checked={filter.precision !== "day"}
              onChange={(event) => patch({ precision: event.target.checked ? "any" : "day" })}
            />
            Include month-only dates
          </label>
        )}
      </div>
      <p className="filter-note">
        Range rows such as &lt;$100 and $1k–$5k match on their minimum. Top sales and last-N-days hide them unless you include them.
        {state.view === "recent" && " Month-only dates are stored as the 1st, so they are left out of the window by default."}
      </p>
    </div>
  );
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function NumberField({
  label,
  value,
  onCommit,
  prefix,
}: {
  label: string;
  value: number | null;
  onCommit: (value: number | null) => void;
  prefix?: string;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => setDraft(value == null ? "" : String(value)), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <span className="input-wrap">
        {prefix && <span className="prefix">{prefix}</span>}
        <input
          inputMode="numeric"
          value={draft}
          onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ""))}
          onBlur={() => onCommit(draft === "" ? null : Number(draft))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              (event.target as HTMLInputElement).blur();
            }
          }}
        />
      </span>
    </label>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="date" value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} />
    </label>
  );
}

function TriField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: "any" | "exclude" | "only";
  onChange: (value: "any" | "exclude" | "only") => void;
}) {
  const options = [
    ["any", "Any"],
    ["exclude", "Hide"],
    ["only", "Only"],
  ] as const;
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="segment" role="group" aria-label={label}>
        {options.map(([key, text]) => (
          <button key={key} type="button" className={value === key ? "is-on" : undefined} aria-pressed={value === key} onClick={() => onChange(key)}>
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function ExtensionMenu({
  extensions,
  selected,
  onChange,
}: {
  extensions: { extension: string; count: number }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const visible = extensions.filter((item) => item.extension.includes(query.toLowerCase()));
  return (
    <details className="menu">
      <summary>All extensions</summary>
      <div className="menu-panel">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter extensions" aria-label="Filter extensions" />
        <div className="menu-list">
          {visible.map((item) => (
            <label key={item.extension}>
              <input
                type="checkbox"
                checked={selected.includes(item.extension)}
                onChange={() => onChange(toggleValue(selected, item.extension))}
              />
              <span>{item.extension}</span>
              <span className="count">{item.count.toLocaleString("en-US")}</span>
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}

function VenueMenu({
  venues,
  selected,
  onChange,
}: {
  venues: { venue: string; count: number }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const label = selected.length === 0 ? "All venues" : selected.length === 1 ? venueName(selected[0]) : `${selected.length} venues`;
  return (
    <details className="menu venue-menu">
      <summary>{label}</summary>
      <div className="menu-panel">
        <div className="menu-list">
          {venues.map((item) => (
            <label key={item.venue}>
              <input
                type="checkbox"
                checked={selected.includes(item.venue)}
                onChange={() => onChange(toggleValue(selected, item.venue))}
              />
              <span>{venueName(item.venue)}</span>
              <span className="count">{item.count.toLocaleString("en-US")}</span>
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}

function venueName(venue: string): string {
  return venue === "Unknown" ? "Not reported" : venue;
}
