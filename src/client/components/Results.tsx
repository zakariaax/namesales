import { Link, useNavigate } from "react-router-dom";
import type { MouseEvent } from "react";
import { formatSaleDate } from "../../shared/dates";
import { formatSalePrice } from "../../shared/price";
import type { SortDir, SortKey } from "../../shared/search";
import type { Sale } from "../../shared/types";
import { PriceText } from "./Chrome";

const COLUMNS: { key: SortKey; label: string; align?: "end" }[] = [
  { key: "domain", label: "Domain" },
  { key: "price", label: "Price", align: "end" },
  { key: "date", label: "Date" },
  { key: "length", label: "Length", align: "end" },
];

export function Results({
  sales,
  sort,
  dir,
  onSort,
}: {
  sales: Sale[];
  sort: SortKey;
  dir: SortDir;
  onSort: (sort: SortKey) => void;
}) {
  const navigate = useNavigate();
  return (
    <>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Domain sales</caption>
          <thead>
            <tr>
              {COLUMNS.slice(0, 3).map((column) => (
                <SortHeader key={column.key} column={column} sort={sort} dir={dir} onSort={onSort} />
              ))}
              <th scope="col">Venue</th>
              <SortHeader column={COLUMNS[3]} sort={sort} dir={dir} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {sales.map((sale) => {
              const href = domainHref(sale.domain);
              const price = formatSalePrice(sale);
              return (
                <tr
                  key={sale.id}
                  className="click-row"
                  onClick={(event) => openRow(event, href, navigate)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") navigate(href);
                  }}
                  tabIndex={0}
                >
                  <td>
                    <DomainName sale={sale} href={href} />
                  </td>
                  <td className="num end">
                    <PriceText {...price} />
                  </td>
                  <td className="num">
                    <DateCell sale={sale} />
                  </td>
                  <td className="venue">{venueLabel(sale.venue)}</td>
                  <td className="num end">{sale.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="cards">
        {sales.map((sale) => {
          const price = formatSalePrice(sale);
          return (
            <Link key={sale.id} className="sale-card" to={domainHref(sale.domain)}>
              <div className="card-top">
                <DomainName sale={sale} />
                <PriceText {...price} />
              </div>
              <p className="card-meta">
                <DateCell sale={sale} />
                {sale.venue !== "Unknown" && <span> · {sale.venue}</span>}
                <span> · {sale.length} letters</span>
              </p>
            </Link>
          );
        })}
      </div>
    </>
  );
}

export function DomainName({ sale, href }: { sale: Sale; href?: string }) {
  const body = (
    <>
      <span className="sld">{sale.sld}</span>
      <span className="ext">{sale.extension}</span>
      {sale.is_idn === 1 && <span className="tag">IDN</span>}
    </>
  );
  if (!href) return <span className="domain-name">{body}</span>;
  return (
    <Link className="domain-name" to={href} onClick={(event) => event.stopPropagation()}>
      {body}
    </Link>
  );
}

export function DateCell({ sale }: { sale: Sale }) {
  return (
    <span className="date-cell" title={sale.date_precision === "month" ? "Month precision. The day was not reported." : sale.date}>
      {formatSaleDate(sale.date, sale.date_precision)}
      {sale.date_precision === "month" && <span className="tag">Month</span>}
    </span>
  );
}

function SortHeader({
  column,
  sort,
  dir,
  onSort,
}: {
  column: { key: SortKey; label: string; align?: "end" };
  sort: SortKey;
  dir: SortDir;
  onSort: (sort: SortKey) => void;
}) {
  const active = sort === column.key;
  return (
    <th scope="col" className={column.align === "end" ? "end" : undefined} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="sort-button" onClick={() => onSort(column.key)}>
        {column.label}
        <span className="sort-arrow" aria-hidden="true">{active ? (dir === "asc" ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );
}

function venueLabel(venue: string) {
  if (venue === "Unknown") return <span className="missing" title="Venue not reported">—</span>;
  return venue;
}

export function domainHref(domain: string): string {
  return `/domain/${encodeURIComponent(domain)}`;
}

function openRow(event: MouseEvent, href: string, navigate: (href: string) => void) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  const target = event.target as HTMLElement;
  if (target.closest("a, button")) return;
  navigate(href);
}

export function Pagination({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pagination">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <div className="pager-pages">
        {pageWindow(page, pages).map((item, index) =>
          item === "gap" ? (
            <span key={`gap-${index}`} className="pager-gap">…</span>
          ) : (
            <button
              key={item}
              type="button"
              className={item === page ? "is-current" : undefined}
              aria-current={item === page ? "page" : undefined}
              onClick={() => onPage(item)}
            >
              {item}
            </button>
          ),
        )}
      </div>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </nav>
  );
}

function pageWindow(page: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const items: (number | "gap")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);
  if (start > 2) items.push("gap");
  for (let i = start; i <= end; i++) items.push(i);
  if (end < pages - 1) items.push("gap");
  items.push(pages);
  return items;
}
