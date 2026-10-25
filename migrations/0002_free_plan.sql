-- Upgrade a database created from the earlier index set, and add the
-- on-demand summary tables. A fresh database already has the v2 sales
-- DDL from 0001; dropping and recreating the four indexes and the FTS
-- table is cheap while the table is still empty. Apply this before the
-- bulk load. domain stays non-unique.

DROP INDEX IF EXISTS idx_sales_sld;
DROP INDEX IF EXISTS idx_sales_extension;
DROP INDEX IF EXISTS idx_sales_length;
DROP INDEX IF EXISTS idx_sales_venue;
DROP INDEX IF EXISTS idx_sales_date_price;
DROP INDEX IF EXISTS idx_sales_venue_date;

DROP INDEX IF EXISTS idx_sales_domain;
DROP INDEX IF EXISTS idx_sales_date;
DROP INDEX IF EXISTS idx_sales_price;
DROP INDEX IF EXISTS idx_sales_ext_price;

CREATE INDEX idx_sales_domain    ON sales(domain);
CREATE INDEX idx_sales_date      ON sales(date);
CREATE INDEX idx_sales_price     ON sales(price_usd);
CREATE INDEX idx_sales_ext_price ON sales(extension, price_usd);

DROP TRIGGER IF EXISTS sales_ai;
DROP TRIGGER IF EXISTS sales_ad;
DROP TRIGGER IF EXISTS sales_au;
DROP TABLE IF EXISTS sales_fts;

CREATE VIRTUAL TABLE sales_fts USING fts5(
  sld, content='sales', content_rowid='id', tokenize='trigram', columnsize=0
);
INSERT INTO sales_fts(sales_fts) VALUES('rebuild');

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

-- Catalog counts, refreshed on demand. Not maintained by the sales triggers,
-- so a partial load does not pay a write per row.
CREATE TABLE IF NOT EXISTS sales_stats (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  total          INTEGER NOT NULL,
  estimates      INTEGER NOT NULL,
  unknown_venues INTEGER NOT NULL,
  date_min       TEXT,
  date_max       TEXT,
  max_id         INTEGER NOT NULL,
  refreshed_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sales_stats_extension (
  extension TEXT PRIMARY KEY,
  n         INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sales_stats_venue (
  venue TEXT PRIMARY KEY,
  n     INTEGER NOT NULL
);
