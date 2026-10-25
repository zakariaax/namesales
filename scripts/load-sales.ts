import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./lib/csv";
import { POST_LOAD_SQL, renderSeedFiles } from "./lib/chunk";
import { rowsFromCsv } from "./lib/rows";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Options {
  csv?: string;
  sqlDir?: string;
  local: boolean;
  remote: boolean;
  reset: boolean;
  applySchema: boolean;
  dryRun: boolean;
  database: string;
  outDir: string;
}

function usage(): never {
  console.log(`Load sales into D1 with chunked \`wrangler d1 execute --file\` statements.
Every CSV row is inserted. The same domain on another date is a resale, not a duplicate.

Usage:
  tsx scripts/load-sales.ts --csv <file.csv> [--local|--remote] [--reset] [--dry-run]
  tsx scripts/load-sales.ts --sql-dir <dir> [--local|--remote] [--apply-schema] [--reset]

--csv       Build INSERT files from a CSV with the sales columns, then execute them.
--sql-dir   Execute prepared seed chunks (seed_0001.sql ...) in order. No rewriting.
--local     Target the local D1 database used by wrangler dev (default).
--remote    Target the remote D1 database. Requires a Cloudflare API token.
--reset     DELETE FROM sales before loading. For a full 225k reload, prefer --apply-schema.
--apply-schema
            Run schema.sql first (drops and recreates sales). Use this for the prepared chunks.
--dry-run   Write SQL files and print the plan. Do not call wrangler.
--database  D1 binding name (default namesales).
--out-dir   Where generated chunks are written (default .seed-chunks).

Each generated statement is at most 500 rows and 90 KB, with no BEGIN/COMMIT.
`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    local: false,
    remote: false,
    reset: false,
    applySchema: false,
    dryRun: false,
    database: "namesales",
    outDir: join(root, ".seed-chunks"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) usage();
      return value;
    };
    if (arg === "--csv") options.csv = resolve(next());
    else if (arg === "--sql-dir") options.sqlDir = resolve(next());
    else if (arg === "--local") options.local = true;
    else if (arg === "--remote") options.remote = true;
    else if (arg === "--reset") options.reset = true;
    else if (arg === "--apply-schema") options.applySchema = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--database") options.database = next();
    else if (arg === "--out-dir") options.outDir = resolve(next());
    else if (arg === "--help" || arg === "-h") usage();
    else usage();
  }
  if (Boolean(options.csv) === Boolean(options.sqlDir)) usage();
  if (options.local && options.remote) usage();
  if (!options.local && !options.remote) options.local = true;
  return options;
}

function wrangler(args: string[]) {
  const bin = join(root, "node_modules", ".bin", "wrangler");
  const result = spawnSync(bin, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`wrangler ${args.join(" ")} failed (${result.status ?? "signal"}).`);
  }
}

function executeFile(database: string, target: "--local" | "--remote", file: string) {
  console.log(`→ ${file}`);
  wrangler(["d1", "execute", database, target, "--yes", "--file", file]);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const target = options.remote ? "--remote" : "--local";
  const where = options.remote ? "remote" : "local";

  let files: string[] = [];
  if (options.csv) {
    const text = readFileSync(options.csv, "utf8");
    const rows = rowsFromCsv(parseCsv(text));
    const chunks = renderSeedFiles(rows);
    rmSync(options.outDir, { recursive: true, force: true });
    mkdirSync(options.outDir, { recursive: true });
    files = chunks.map((sql, index) => {
      const path = join(options.outDir, `seed_${String(index + 1).padStart(4, "0")}.sql`);
      writeFileSync(path, sql);
      return path;
    });
    console.log(`Prepared ${rows.length} rows in ${files.length} SQL file(s) for ${where} D1 '${options.database}'.`);
  } else if (options.sqlDir) {
    files = readdirSync(options.sqlDir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => join(options.sqlDir as string, name));
    if (!files.length) throw new Error(`No .sql files in ${options.sqlDir}`);
    console.log(`Found ${files.length} prepared SQL file(s) for ${where} D1 '${options.database}'.`);
  }

  if (options.dryRun) {
    console.log("Dry run only. Files were not executed.");
    for (const file of files) console.log(`  ${file}`);
    return;
  }

  if (options.applySchema) {
    executeFile(options.database, target, join(root, "schema.sql"));
  } else if (options.reset) {
    const resetPath = join(options.outDir, "_reset.sql");
    mkdirSync(options.outDir, { recursive: true });
    writeFileSync(resetPath, "DELETE FROM sales;\n");
    executeFile(options.database, target, resetPath);
  }

  for (const file of files) executeFile(options.database, target, file);

  const postPath = join(options.outDir, "_post.sql");
  mkdirSync(dirname(postPath), { recursive: true });
  writeFileSync(postPath, POST_LOAD_SQL);
  executeFile(options.database, target, postPath);

  console.log("Load finished. Confirm counts with:");
  console.log(`  npx wrangler d1 execute ${options.database} ${target} --command "SELECT COUNT(*) AS sales FROM sales; SELECT COUNT(*) AS fts FROM sales_fts;"`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
