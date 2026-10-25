# NameSales

NameSales is a domain-sales database: search published aftermarket sales, open a domain, and compare it with similar names. It is a faster, calmer alternative to NameBio.

The app is a TypeScript Cloudflare Worker. D1 (SQLite) holds the sales. The Worker serves a JSON API and the built static UI. Nothing in this repo is deployed, and **real sales data is not committed**. The checked-in fixture is a few hundred invented rows (`source` is `Sample Fixture`).

## Stack

- Cloudflare Workers + D1, local via Wrangler
- Workers static assets for the Vite + React frontend
- FTS5 trigram index on `sld` for keyword search

## Project layout

```
schema.sql                 prepared dataset DDL (drops and recreates)
migrations/0001_init.sql   same DDL, without the drops, for wrangler migrations
src/worker                 API: search, domain, comps, top and recent feeds
src/client                 search page and domain page
src/shared                 price formatting and SQL that the tests exercise
scripts/load-sales.ts      CSV → chunked SQL, or run prepared seed chunks
fixtures/sample-sales.csv  synthetic rows for local dev
```

Later milestones have a home in `src/worker/future.ts`: keyword and extension stats, daily and monthly reports, CSV export, saved searches, and watchlists. Top sales and last-N-days feeds are already mounted, because range rows have to stay out of them unless you opt in.

## Setup

Node 20 or newer.

```bash
npm install
npx wrangler d1 migrations apply namesales --local
npm run db:sample
npm run dev
```

`npm run dev` builds the frontend and starts `wrangler dev` (default http://127.0.0.1:8787). After a build, `npx wrangler dev` alone is enough.

`database_id` in `wrangler.toml` is a placeholder. Local D1 does not need a real id.

Regenerate the synthetic fixture with `npm run generate:sample`. Do not point that script at real data.

## Resales

A domain can sell more than once. `sales.id` is the primary key, and there is no unique constraint on `domain`. A 2019 sale and a 2023 sale of the same name are two rows. Search results, comps, the seed loader, and the domain page all keep them. The domain page lists the full history newest first, with a price chart of those same rows, before comparable names.

## How prices and dates behave

The table matches the prepared dataset:

- `price_usd` is the exact price, or the **range minimum** when `price_is_estimate` is 1.
- About 31.9k rows are NameBio ranges. Their dates are month precision, stored as `YYYY-MM-01` with `date_precision = 'month'`. The UI shows the bucket (`<$100`, `$1k–$5k`, …) and the month, not a fake day or a fake exact price.
- 9,504 `<$100` rows have `price_usd = 0` and `price_max_usd = 99`. They display as `<$100`.
- About 71% of venues are `Unknown`. The UI shows that as “not reported” (an em dash in the table) instead of treating it like a marketplace.
- **Top sales** (`/api/feeds/top`) and **last N days** (`/api/feeds/recent`) exclude estimates by default. The recent feed also requires `date_precision = 'day'`, so month rows pinned to the 1st do not fall into the window. Pass `estimates=include` and, for the recent feed, `precision=any` to put them back. The same toggles are on the Top sales and Recent views.

Keyword search uses the FTS5 trigram index when the term is at least 3 characters (`MATCH '"crypto"'`). Starts with and exact use a range on the domain index, including a one- or two-character prefix. Contains and ends with need 3 characters unless you also set an extension, price range, or date range. D1 limits `LIKE` patterns to 50 bytes; longer input is trimmed.

## Indexes, counts, and partial loads

D1's free plan allows 100,000 rows written per day and 5 million rows read per day. Each secondary index costs another row write per sale, so the table keeps four: `domain`, `date`, `price_usd`, and `(extension, price_usd)`. The FTS index uses `columnsize=0`, which skips the per-row docsize table. There is still no unique constraint on `domain`.

Apply the migrations on an empty database, then load. `0002_free_plan.sql` drops the earlier extra indexes and rebuilds FTS with `columnsize=0`. That rebuild is cheap on an empty table and expensive after 226k rows are already loaded.

Queries take one of those indexes (or FTS) as the access path and apply length, venue, hyphen, digit, estimate, and precision filters on top. Every search has `LIMIT`/`OFFSET`, and offset stops at 2,000 rows. Match counts stop after 500 rows (`500+` in the UI) instead of `COUNT(*)` on the whole table. The unfiltered catalog total comes from `sales_stats`, `sales_stats_extension`, and `sales_stats_venue`.

Those summary tables are not updated on every insert. A Worker cron at 01:30 UTC rebuilds them (`[triggers] crons` in `wrangler.toml`). Cron triggers are free. A normal `/api/meta` request rebuilds only when the summary is missing or older than 24 hours, so a public page load cannot scan the table all day.

A manual rebuild needs `ADMIN_KEY`, set with `npx wrangler secret put ADMIN_KEY` (or `.dev.vars` locally, which is gitignored):

```bash
curl -s "http://127.0.0.1:8787/api/meta?refresh=1&key=$ADMIN_KEY"
```

`?refresh=1` without the key is ignored when a rebuild already ran in the last 24 hours. The extension and venue inserts are `INSERT … SELECT … GROUP BY` with no bound parameters, because D1 allows at most 100 parameters per statement.

Later `/api/meta` calls read the summary and compare `MAX(id)` and `MAX(date)` (index lookups). When a load adds rows, the app marks the counts stale and keeps serving search, domain history, and comps from whatever is already loaded. Newest-first loads show up in the default date sort immediately. The banner says the counts catch up at the nightly refresh.

## Load the full dataset

Keep `sales.csv` and the `seed/` chunks outside this repo. Two equivalent paths:

Prepared chunks (the `seed_0001.sql` … files, already sized for D1):

```bash
npx tsx scripts/load-sales.ts \
  --sql-dir /absolute/path/to/seed \
  --local \
  --apply-schema
```

`--apply-schema` runs `schema.sql` first. That file drops `sales` and rebuilds it, which is the right reload for all 225,029 rows.

From the CSV (the loader writes the same style of chunks: multi-row inserts, at most 500 rows and 90 KB per statement, no `BEGIN`/`COMMIT`, files under 4.5 MB):

```bash
npx tsx scripts/load-sales.ts --csv /absolute/path/to/sales.csv --local --apply-schema
```

Use `--remote` instead of `--local` once a database id and API token exist. `--dry-run` writes the SQL and stops. After the chunks, the loader runs FTS `optimize` and `ANALYZE`.

Confirm:

```bash
npx wrangler d1 execute namesales --local \
  --command "SELECT COUNT(*) AS sales FROM sales; SELECT COUNT(*) AS fts FROM sales_fts;"
```

Both counts should match the rows loaded so far (225,029 once the full set is in). `COUNT(*)` reads every row, so run it once to confirm a load, not on each request. Day to day, the cron-built summary is the count the app uses. The app keeps working while chunks are still loading.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/search` | Keyword, extension, venue, price, date, length, digits, hyphens, sort, page |
| GET | `/api/feeds/top` | Highest prices. Estimates excluded unless `estimates=include` |
| GET | `/api/feeds/recent` | `days` (default 30), `as_of` optional. Estimates and month-only dates excluded unless opted in |
| GET | `/api/domains/:domain` | Every recorded sale of that domain |
| GET | `/api/domains/:domain/comps` | Other extensions, similar names, similar length, nearby exact prices |
| GET | `/api/meta` | Cached extension and venue facets. `?refresh=1&key=` rebuilds them when the key matches `ADMIN_KEY`. Without the key, at most once per day |
| GET | `/api/health` | Liveness. `sales` is the cached total, or null when that cache lags the load |

Search parameters are the same ones in the page URL, so a results link is a search you can re-run. `match` is `contains`, `starts`, `ends`, or `exact`. Sort is `date`, `price`, `domain`, or `length`.

## Tests

```bash
npm test
npm run smoke
```

`npm test` covers price labels, the SQL builder, and the chunker. `npm run smoke` reloads the sample into local D1, builds the UI, starts Wrangler, and checks search, feeds, comps, and the `/domain/name.co.uk` route.

## Deploy

When a Cloudflare API token is available (D1 edit and Workers scripts edit):

```bash
npx wrangler login
npx wrangler d1 create namesales
```

Put the printed id in `wrangler.toml` as `database_id`, then:

```bash
npx wrangler d1 migrations apply namesales --remote
npx tsx scripts/load-sales.ts --sql-dir /absolute/path/to/seed --remote
npm run build
npx wrangler deploy
```

For a first remote load you can skip the migrations step and use `--apply-schema --remote` instead. Do not commit the token, the real CSV, or the seed chunks.
