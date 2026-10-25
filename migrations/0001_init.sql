-- NameSales initial migration.
-- The DDL below matches schema.sql exactly (from CREATE TABLE through the triggers).
-- schema.sql also drops existing tables; Wrangler applies this file once to an empty
-- database, so those drops are omitted here.
-- domain is not unique. The same name can sell again on a later date.

CREATE TABLE sales (
  id                INTEGER PRIMARY KEY,          -- stable id from sales.csv
  domain            TEXT    NOT NULL,             -- lowercase full domain, e.g. 'example.co.uk'
  sld               TEXT    NOT NULL,             -- label left of the extension, e.g. 'example'
  extension         TEXT    NOT NULL,             -- public suffix with dot, e.g. '.com', '.co.uk'
  date              TEXT    NOT NULL,             -- ISO YYYY-MM-DD (month-precision rows use YYYY-MM-01)
  date_precision    TEXT    NOT NULL DEFAULT 'day' CHECK (date_precision IN ('day','month')),
  price_usd         INTEGER NOT NULL,             -- exact price, or range minimum when price_is_estimate=1
  price_is_estimate INTEGER NOT NULL DEFAULT 0 CHECK (price_is_estimate IN (0,1)),
  price_range       TEXT,                         -- original NameBio bucket text, e.g. '1,000-4,999', '<100'
  price_min_usd     INTEGER,
  price_max_usd     INTEGER,
  venue             TEXT    NOT NULL DEFAULT 'Unknown',  -- canonical marketplace (Sedo, Afternic, GoDaddy, ...)
  source            TEXT    NOT NULL,             -- canonical reporter (DNJournal, NameBio, DomainGang, ...)
  source_original   TEXT,                         -- source label as it appeared in the input
  source_url        TEXT,
  also_reported_by  TEXT,
  price_note        TEXT,                         -- e.g. currency conversion note
  original_price    TEXT,                         -- e.g. 'EUR 10,000'
  origin_file       TEXT,                         -- provenance: input file the row came from
  length            INTEGER NOT NULL,             -- length of sld
  has_hyphen        INTEGER NOT NULL DEFAULT 0,
  has_digit         INTEGER NOT NULL DEFAULT 0,
  is_numeric        INTEGER NOT NULL DEFAULT 0,   -- sld is digits only
  is_idn            INTEGER NOT NULL DEFAULT 0,   -- punycode xn--
  tld_levels        INTEGER NOT NULL DEFAULT 1    -- 1 = .com, 2 = .co.uk
);

-- Write cost per inserted sale = 1 (table row) + 1 per secondary index + FTS (amortised, no docsize rows).
-- Only 4 secondary indexes are kept (each one costs +1 row written per sale on D1):
CREATE INDEX idx_sales_domain     ON sales(domain);                    -- domain detail page / exact lookup / future dedupe
CREATE INDEX idx_sales_date       ON sales(date);                      -- newest sales, date-range lists (top last N days)
CREATE INDEX idx_sales_price      ON sales(price_usd);                 -- all-time / any-ext leaderboards ORDER BY price DESC
CREATE INDEX idx_sales_ext_price  ON sales(extension, price_usd);      -- extension filter + price range / sort (scans either direction)
-- Dropped vs v1 (filter these in combination with the indexes above instead):
--   sld (use FTS or domain), extension (covered by ext_price prefix), length, venue, date_price, venue_date.

-- Substring keyword search on sld (trigram: any 3+ char substring, e.g. 'crypt' -> encrypted.com).
-- columnsize=0 drops the per-row sales_fts_docsize table (saves 1 row written per sale; bm25 ranking not needed).
-- Query:  ... FROM sales_fts f JOIN sales s ON s.id=f.rowid WHERE sales_fts MATCH '"crypto"'   (or f.sld LIKE '%crypto%')
CREATE VIRTUAL TABLE sales_fts USING fts5(
  sld, content='sales', content_rowid='id', tokenize='trigram', columnsize=0
);
CREATE TRIGGER sales_ai AFTER INSERT ON sales BEGIN
  INSERT INTO sales_fts(rowid, sld) VALUES (new.id, new.sld);
END;
CREATE TRIGGER sales_ad AFTER DELETE ON sales BEGIN
  INSERT INTO sales_fts(sales_fts, rowid, sld) VALUES ('delete', old.id, old.sld);
END;
CREATE TRIGGER sales_au AFTER UPDATE OF sld ON sales BEGIN
  INSERT INTO sales_fts(sales_fts, rowid, sld) VALUES ('delete', old.id, old.sld);
  INSERT INTO sales_fts(rowid, sld) VALUES (new.id, new.sld);
END;
