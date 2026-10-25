import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getJson } from "../api";
import { PriceChart } from "../components/PriceChart";
import { DateCell, DomainName, domainHref } from "../components/Results";
import { PriceText } from "../components/Chrome";
import { formatSaleDate } from "../../shared/dates";
import { formatSalePrice } from "../../shared/price";
import type { CompsResponse, DomainResponse, Sale } from "../../shared/types";

export function DomainPage() {
  const splat = useParams()["*"] ?? "";
  const domain = decodeURIComponent(splat);
  const [detail, setDetail] = useState<DomainResponse | null>(null);
  const [comps, setComps] = useState<CompsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setComps(null);
    setError(null);
    const encoded = encodeURIComponent(domain);
    Promise.all([
      getJson<DomainResponse>(`/api/domains/${encoded}`, controller.signal),
      getJson<CompsResponse>(`/api/domains/${encoded}/comps`, controller.signal),
    ])
      .then(([nextDetail, nextComps]) => {
        setDetail(nextDetail);
        setComps(nextComps);
        document.title = `${nextDetail.domain} · NameSales`;
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Could not load that domain.");
        document.title = "Domain · NameSales";
      });
    return () => controller.abort();
  }, [domain]);

  return (
    <main className="page domain-page">
      <Link className="back" to="/">All sales</Link>
      {!detail && !error && <div className="skeleton" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div>}
      {error && (
        <div className="empty">
          <h1>No sales for this domain</h1>
          <p>{error}</p>
        </div>
      )}
      {detail && (
        <>
          <header className="domain-head">
            <h1>
              <span className="sld">{detail.sld}</span>
              <span className="ext">{detail.extension}</span>
            </h1>
            <p className="lede">
              {detail.length} {detail.length === 1 ? "character" : "characters"}
              {detail.tld_levels > 1 ? " · multi-level extension" : ""}
              {detail.is_idn === 1 ? " · IDN" : ""}
            </p>
            <dl className="summary">
              <div>
                <dt>Sales</dt>
                <dd>{detail.summary.count}</dd>
              </div>
              <div>
                <dt>Highest exact</dt>
                <dd>
                  {detail.summary.max_exact_price == null
                    ? "None"
                    : formatSalePrice({
                        price_usd: detail.summary.max_exact_price,
                        price_is_estimate: 0,
                        price_range: null,
                        price_min_usd: null,
                        price_max_usd: null,
                      }).text}
                </dd>
              </div>
              <div>
                <dt>Latest</dt>
                <dd>{formatSaleDate(detail.summary.latest_date, detail.summary.latest_precision)}</dd>
              </div>
            </dl>
          </header>

          <section className="history">
            <h2>Sales history</h2>
            <p className="lede">Newest first. Each date is its own sale, including later resales.</p>
            <PriceChart sales={detail.sales} />
            <div className="stack">
              {detail.sales.map((sale) => (
                <SaleBlock key={sale.id} sale={sale} />
              ))}
            </div>
          </section>

          {comps && (
            <section className="comps">
              <h2>Comparable sales</h2>
              <p className="lede">
                Based on the latest sale, {formatSalePrice(comps.basis).text} on {formatSaleDate(comps.basis.date, comps.basis.date_precision)}.
              </p>
              <CompList title={`${detail.sld} in other extensions`} sales={comps.same_name} />
              <CompList title={`Names like “${detail.sld}”`} sales={comps.similar_keyword} />
              <CompList
                title={`${detail.extension} names within 1 character of this length`}
                sales={comps.similar_length}
              />
              {comps.basis.price_usd > 0 && (
                <CompList
                  title={`Exact ${detail.extension} sales priced near ${formatSalePrice({ ...comps.basis, price_is_estimate: 0, price_range: null }).text}`}
                  sales={comps.nearby_price}
                />
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}

function SaleBlock({ sale }: { sale: Sale }) {
  const price = formatSalePrice(sale);
  return (
    <article className="sale-block">
      <div className="sale-main">
        <PriceText {...price} />
        <DateCell sale={sale} />
        <span className="venue">{sale.venue === "Unknown" ? "Venue not reported" : sale.venue}</span>
        <span className="source">{sale.source}</span>
      </div>
      <ul className="sale-notes">
        {!price.exact && <li>Reported range, not an exact price.</li>}
        {sale.original_price && <li>Original amount {sale.original_price}</li>}
        {sale.price_note && <li>{sale.price_note}</li>}
        {sale.also_reported_by && <li>Also reported by {sale.also_reported_by}</li>}
        {sale.source_url && (
          <li>
            <a href={sale.source_url} target="_blank" rel="noreferrer">Source link</a>
          </li>
        )}
      </ul>
    </article>
  );
}

function CompList({ title, sales }: { title: string; sales: Sale[] }) {
  return (
    <section className="comp-block">
      <h3>{title}</h3>
      {sales.length === 0 ? (
        <p className="muted">None in this database.</p>
      ) : (
        <ul className="comp-list">
          {sales.map((sale) => {
            const price = formatSalePrice(sale);
            return (
              <li key={sale.id}>
                <Link to={domainHref(sale.domain)}>
                  <DomainName sale={sale} />
                  <PriceText {...price} />
                  <span className="muted">
                    <DateCell sale={sale} />
                    {sale.venue !== "Unknown" && ` · ${sale.venue}`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
