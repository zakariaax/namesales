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

Keyword search uses the FTS5 trigram index when the term is at least 3 characters (`MATCH '"crypto"'`). Shorter terms use a prefix (`sld LIKE 'ab%'`). D1 limits `LIKE` patterns to 50 bytes; longer input is trimmed.

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

Both counts should be 225,029.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/search` | Keyword, extension, venue, price, date, length, digits, hyphens, sort, page |
| GET | `/api/feeds/top` | Highest prices. Estimates excluded unless `estimates=include` |
| GET | `/api/feeds/recent` | `days` (default 30), `as_of` optional. Estimates and month-only dates excluded unless opted in |
| GET | `/api/domains/:domain` | Every recorded sale of that domain |
| GET | `/api/domains/:domain/comps` | Other extensions, similar names, similar length, nearby exact prices |
| GET | `/api/meta` | Extension and venue facets |
| GET | `/api/health` | Row count |

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
