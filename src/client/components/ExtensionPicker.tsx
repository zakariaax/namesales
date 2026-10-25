import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { getJson } from "../api";
import { arrangeExtensions, type ExtensionCount } from "../../shared/extensions";

const MAX_SELECTED = 20;

let catalogPromise: Promise<ExtensionCount[]> | null = null;

function loadCatalog(): Promise<ExtensionCount[]> {
  if (!catalogPromise) {
    catalogPromise = getJson<{ extensions: ExtensionCount[] }>("/api/extensions")
      .then((body) => {
        if (!body.extensions.length) catalogPromise = null;
        return body.extensions;
      })
      .catch((error: unknown) => {
        catalogPromise = null;
        throw error;
      });
  }
  return catalogPromise;
}

export function ExtensionPicker({
  selected,
  seed,
  onChange,
}: {
  selected: string[];
  seed?: ExtensionCount[];
  onChange: (next: string[]) => void;
}) {
  const [catalog, setCatalog] = useState<ExtensionCount[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [narrow, setNarrow] = useState(false);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 860px)");
    const apply = () => setNarrow(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (catalog.length === 0 && seed && seed.length > 0) setCatalog(seed);
  }, [catalog.length, seed]);

  useEffect(() => {
    let cancel = false;
    loadCatalog().then((rows) => {
      if (!cancel && rows.length > 0) setCatalog(rows);
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  const view = useMemo(() => arrangeExtensions(catalog, query), [catalog, query]);
  const flat = useMemo(() => view.groups.flatMap((group) => group.items), [view]);

  useEffect(() => setActive(0), [query, open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(listId, active))?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId, view]);

  const toggle = (extension: string) => {
    if (selected.includes(extension)) {
      onChange(selected.filter((item) => item !== extension));
      return;
    }
    if (selected.length >= MAX_SELECTED) return;
    onChange([...selected, extension]);
  };

  const onInputKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(flat.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(0, flat.length - 1));
    } else if (event.key === "Enter" && open && flat[active]) {
      event.preventDefault();
      toggle(flat[active].extension);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  const panel = open ? (
    <div className={narrow ? "ext-sheet" : "ext-popover"} role="presentation">
      {narrow && (
        <div className="ext-sheet-head">
          <strong>Extensions</strong>
          <button type="button" className="text-button" onClick={() => setOpen(false)}>Done</button>
        </div>
      )}
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={flat[active] ? optionId(listId, active) : undefined}
        value={query}
        aria-label="Filter extensions"
        placeholder="Type to filter, such as com or uk"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={onInputKey}
      />
      <div id={listId} role="listbox" aria-multiselectable="true" aria-label="Extensions" className="ext-options">
        {flat.length === 0 && <p className="ext-empty">No extensions match.</p>}
        {view.groups.map((group) => {
          const start = flat.findIndex((item) => item.extension === group.items[0]?.extension);
          return (
            <div key={group.name} role="group" aria-label={group.name}>
              <div className="ext-group">{group.name}</div>
              {group.items.map((item, index) => {
                const optionIndex = start + index;
                const isSelected = selected.includes(item.extension);
                return (
                  <button
                    key={item.extension}
                    id={optionId(listId, optionIndex)}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={optionIndex === active ? "ext-option is-active" : "ext-option"}
                    onMouseEnter={() => setActive(optionIndex)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => toggle(item.extension)}
                  >
                    <span className="ext-name">
                      {isSelected && <span className="ext-check" aria-hidden="true">✓</span>}
                      {item.extension}
                    </span>
                    <span className="count">{item.count.toLocaleString("en-US")}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
        {view.totalMatches > view.shown && (
          <p className="ext-more">
            Showing {view.shown} of {view.totalMatches.toLocaleString("en-US")}. Keep typing to narrow the list.
          </p>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className={open ? "ext-picker is-open" : "ext-picker"}>
      <div className="ext-label-row">
        <span className="ext-label">Extension</span>
        {selected.length > 0 && (
          <button type="button" className="text-button" onClick={() => onChange([])}>
            Any extension
          </button>
        )}
      </div>
      {selected.length > 0 && (
        <div className="chips" aria-label="Selected extensions">
          {selected.map((extension) => (
            <button key={extension} type="button" className="chip is-on" onClick={() => toggle(extension)}>
              {extension}
              <span className="chip-x" aria-hidden="true">×</span>
              <span className="sr-only">Remove {extension}</span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="ext-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
            return;
          }
          if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            setQuery(event.key.toLowerCase());
            setOpen(true);
          }
        }}
      >
        {selected.length === 0 ? "Any extension" : "Add an extension"}
      </button>
      {selected.length >= MAX_SELECTED && <p className="ext-more">20 extensions is the limit.</p>}
      {open && narrow && createPortal(
        <>
          <button type="button" className="ext-backdrop" aria-label="Close extensions" onClick={() => setOpen(false)} />
          {panel}
        </>,
        document.body,
      )}
      {open && !narrow && createPortal(
        <button type="button" className="ext-backdrop ext-backdrop-quiet" aria-label="Close extensions" onClick={() => setOpen(false)} />,
        document.body,
      )}
      {open && !narrow && panel}
    </div>
  );
}

function optionId(listId: string, index: number): string {
  return `${listId}-opt-${index}`;
}
