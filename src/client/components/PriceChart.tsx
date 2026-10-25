import { formatSaleDate } from "../../shared/dates";
import { formatSalePrice } from "../../shared/price";
import type { Sale } from "../../shared/types";

const WIDTH = 720;
const HEIGHT = 168;
const PAD = { left: 62, right: 18, top: 14, bottom: 30 };

/** Oldest on the left. Every sale is a mark, including resales of the same domain. */
export function PriceChart({ sales }: { sales: Sale[] }) {
  const marks = [...sales]
    .sort((a, b) => a.date.localeCompare(b.date) || a.price_usd - b.price_usd || a.id - b.id)
    .map((sale) => {
      const label = formatSalePrice(sale);
      const low = sale.price_is_estimate ? (sale.price_min_usd ?? sale.price_usd) : sale.price_usd;
      const high = sale.price_is_estimate
        ? (sale.price_max_usd ?? (sale.price_usd === 0 ? 99 : sale.price_usd))
        : sale.price_usd;
      return { sale, label, low, high, exact: label.exact };
    });
  if (!marks.length) return null;

  const ceiling = niceCeiling(Math.max(100, ...marks.map((mark) => mark.high)));
  const times = marks.map((mark) => Date.parse(`${mark.sale.date}T00:00:00Z`));
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const span = Math.max(maxTime - minTime, 1);
  const spanDays = span / 86_400_000;

  const xAt = (time: number, index: number) => {
    const inner = WIDTH - PAD.left - PAD.right;
    if (maxTime === minTime) return PAD.left + (inner * (index + 1)) / (marks.length + 1);
    return PAD.left + ((time - minTime) / span) * inner;
  };
  const yAt = (value: number) => {
    const inner = HEIGHT - PAD.top - PAD.bottom;
    return PAD.top + inner * (1 - Math.min(value, ceiling) / ceiling);
  };

  const exactPoints = marks.flatMap((mark, index) =>
    mark.exact ? [`${xAt(times[index], index)},${yAt(mark.sale.price_usd)}`] : [],
  );

  return (
    <figure className="chart-card">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Sale prices over time. Each mark is a separate sale.">
        {[0, ceiling / 2, ceiling].map((tick) => (
          <g key={tick}>
            <line className="chart-grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={yAt(tick)} y2={yAt(tick)} />
            <text className="chart-label" x={PAD.left - 8} y={yAt(tick) + 4} textAnchor="end">
              {compactAxis(tick)}
            </text>
          </g>
        ))}
        {exactPoints.length > 1 && <polyline className="chart-line" points={exactPoints.join(" ")} />}
        {marks.map((mark, index) => {
          const x = xAt(times[index], index);
          const title = `${formatSaleDate(mark.sale.date, mark.sale.date_precision)} · ${mark.label.text}`;
          if (!mark.exact) {
            return (
              <g key={mark.sale.id}>
                <title>{title}</title>
                <line className="chart-range" x1={x} x2={x} y1={yAt(mark.low)} y2={yAt(mark.high)} />
                <circle className="chart-range-dot" cx={x} cy={yAt(mark.high)} r="4" />
              </g>
            );
          }
          return (
            <g key={mark.sale.id}>
              <title>{title}</title>
              <circle className="chart-dot" cx={x} cy={yAt(mark.sale.price_usd)} r="5" />
            </g>
          );
        })}
        {axisDates(marks, spanDays).map((item) => (
          <text
            key={item.index}
            className="chart-label"
            x={xAt(times[item.index], item.index)}
            y={HEIGHT - 10}
            textAnchor="middle"
          >
            {item.text}
          </text>
        ))}
      </svg>
      <figcaption>Exact prices are connected. A later sale of the same domain stays on the chart.</figcaption>
    </figure>
  );
}

function axisDates(marks: { sale: Sale }[], spanDays: number): { index: number; text: string }[] {
  const indexes = [0];
  if (marks.length > 2) indexes.push(Math.floor((marks.length - 1) / 2));
  if (marks.length > 1) indexes.push(marks.length - 1);
  return [...new Set(indexes)].map((index) => ({
    index,
    text: spanDays > 800 ? marks[index].sale.date.slice(0, 4) : formatSaleDate(marks[index].sale.date, "month"),
  }));
}

function niceCeiling(value: number): number {
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const leading = value / magnitude;
  const nice = leading <= 1 ? 1 : leading <= 2 ? 2 : leading <= 2.5 ? 2.5 : leading <= 5 ? 5 : 10;
  return nice * magnitude;
}

function compactAxis(value: number): string {
  if (value === 0) return "$0";
  if (value >= 1_000_000) return `$${trimNumber(value / 1_000_000)}M`;
  if (value >= 1000) return `$${trimNumber(value / 1000)}k`;
  return `$${Math.round(value)}`;
}

function trimNumber(value: number): string {
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return String(rounded);
}
