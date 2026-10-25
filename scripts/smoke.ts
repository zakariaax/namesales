import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompsResponse, DomainResponse, SearchResponse } from "../src/shared/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 8791;
const base = `http://127.0.0.1:${port}`;

function wrangler(args: string[]) {
  const result = spawnSync(join(root, "node_modules", ".bin", "wrangler"), args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`wrangler ${args.join(" ")} failed`);
  }
}

async function waitForServer(child: ChildProcess) {
  const started = Date.now();
  let log = "";
  child.stdout?.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    log += chunk.toString();
  });
  while (Date.now() - started < 60_000) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    if (child.exitCode != null) throw new Error(`wrangler dev exited early:\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out waiting for wrangler dev.\n${log}`);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${base}${path}`);
  const body = await response.json();
  if (!response.ok) throw new Error(`${path} → ${response.status} ${JSON.stringify(body)}`);
  return body as T;
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log("Applying migrations and loading the sample fixture…");
  wrangler(["d1", "migrations", "apply", "namesales", "--local"]);
  wrangler(["d1", "execute", "namesales", "--local", "--yes", "--command", "DELETE FROM sales;"]);
  const load = spawnSync(join(root, "node_modules", ".bin", "tsx"), ["scripts/load-sales.ts", "--csv", "fixtures/sample-sales.csv", "--local"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  });
  if (load.stdout) process.stdout.write(load.stdout);
  if (load.status !== 0) {
    if (load.stderr) process.stderr.write(load.stderr);
    throw new Error("sample load failed");
  }

  console.log("Building the frontend…");
  const build = spawnSync(join(root, "node_modules", ".bin", "vite"), ["build"], { cwd: root, encoding: "utf8" });
  if (build.stdout) process.stdout.write(build.stdout);
  if (build.status !== 0) {
    if (build.stderr) process.stderr.write(build.stderr);
    throw new Error("vite build failed");
  }

  console.log("Starting wrangler dev…");
  const child = spawn(join(root, "node_modules", ".bin", "wrangler"), ["dev", "--port", String(port), "--ip", "127.0.0.1"], {
    cwd: root,
    env: { ...process.env, CI: "true", BROWSER: "none" },
  });
  try {
    await waitForServer(child);
    const sampleLines = readFileSync(join(root, "fixtures", "sample-sales.csv"), "utf8").trim().split("\n").length - 1;
    const health = await getJson<{ ok: boolean; sales: number }>("/api/health");
    assert(health.ok && health.sales === sampleLines, `expected ${sampleLines} sales, got ${health.sales}`);

    const fts = await getJson<SearchResponse>("/api/search?q=lane&match=contains&page_size=100");
    assert(fts.match_applied === "fts", "3+ character search should use FTS");
    assert(fts.results.some((row) => row.sld === "harborlane"), "FTS should find harborlane for “lane”");

    const prefix = await getJson<SearchResponse>("/api/search?q=ha&match=contains&page_size=100");
    assert(prefix.match_applied === "prefix", "short search should fall back to a prefix");
    assert(prefix.results.every((row) => row.sld.startsWith("ha")), "prefix results should start with ha");

    const exact = await getJson<SearchResponse>("/api/search?q=harborlane&match=exact&page_size=100");
    assert(exact.results.length >= 4, "expected several harborlane sales");
    assert(exact.results.every((row) => row.sld === "harborlane"), "exact match leaked other names");

    const top = await getJson<SearchResponse>("/api/feeds/top?page_size=100");
    assert(top.results.every((row) => row.price_is_estimate === 0), "top sales included a range estimate");
    assert(top.results[0]?.domain === "cedarfolio.com", `top sale was ${top.results[0]?.domain}`);
    for (let i = 1; i < top.results.length; i++) {
      assert(top.results[i - 1].price_usd >= top.results[i].price_usd, "top sales are not price-sorted");
    }
    const topWithRanges = await getJson<SearchResponse>("/api/feeds/top?estimates=include&page_size=100");
    assert(topWithRanges.results.some((row) => row.price_is_estimate === 1), "include toggle did not return estimates");

    const recent = await getJson<SearchResponse>("/api/feeds/recent?days=30&as_of=2026-10-25&page_size=100");
    assert(recent.window?.from === "2026-09-25", "recent window start was wrong");
    assert(recent.results.some((row) => row.domain === "harborlane.com" && row.date === "2026-10-22"), "missing recent harborlane sale");
    assert(recent.results.every((row) => row.price_is_estimate === 0 && row.date_precision === "day"), "recent feed included an estimate or month row");
    assert(recent.results.every((row) => row.date >= "2026-09-25" && row.date <= "2026-10-25"), "recent feed left the window");
    assert(!recent.results.some((row) => row.domain === "sample-ledger.com" && row.date === "2026-09-20"), "a sale from before the window was included");

    const recentAll = await getJson<SearchResponse>("/api/feeds/recent?days=30&as_of=2026-10-25&estimates=include&precision=any&page_size=100");
    assert(recentAll.results.some((row) => row.domain === "lowsample.net" && row.price_usd === 0), "month-only <$100 row should return when the toggles are on");

    const domain = await getJson<DomainResponse>("/api/domains/harborlane.com");
    assert(domain.sales.length >= 3, "domain history should keep every resale");
    assert(domain.sales[0].date >= domain.sales[domain.sales.length - 1].date, "history should be newest first");
    const dates = new Set(domain.sales.map((row) => row.date));
    assert(dates.has("2026-10-22") && dates.has("2021-06-12"), "an earlier resale was dropped");
    const comps = await getJson<CompsResponse>("/api/domains/harborlane.com/comps");
    assert(comps.same_name.some((row) => row.domain === "harborlane.io"), "missing same-name comp");
    assert(comps.same_name.some((row) => row.domain === "harborlane.net" && row.price_is_estimate === 1), "missing range comp");
    assert(comps.similar_keyword.some((row) => row.sld.includes("harborlane") || row.sld.replaceAll("-", "") === "harborlane"), "missing keyword comp");

    const page = await fetch(`${base}/domain/silverferry.co.uk`);
    const html = await page.text();
    assert(page.ok && html.includes('id="root"'), "dotted domain route did not serve the app shell");

    console.log("Smoke checks passed.");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
