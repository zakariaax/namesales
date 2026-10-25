import { Hono } from "hono";
import { domainComps, domainSales, filterFromUrl, healthStatus, meta, searchSales } from "./db";
import type { Env } from "./env";
import { rebuildCatalog } from "./stats";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", async (c) => json(await healthStatus(c.env.DB)));

app.get("/api/meta", async (c) => {
  const url = new URL(c.req.url);
  const wantsRefresh = url.searchParams.get("refresh") === "1";
  const key = url.searchParams.get("key") ?? "";
  if (wantsRefresh && key) {
    if (!keyMatches(c.env.ADMIN_KEY, key)) {
      return json({ error: { code: "forbidden", message: "Refresh key was not accepted." } }, 403);
    }
    return json(await meta(c.env.DB, "forced"));
  }
  return json(await meta(c.env.DB, wantsRefresh ? "public" : "auto"));
});

app.get("/api/search", async (c) => {
  const url = new URL(c.req.url);
  const parsed = filterFromUrl(url, "search");
  if ("error" in parsed) return bad(parsed.error);
  return json(await searchSales(c.env.DB, parsed.filter, undefined, url.origin));
});

app.get("/api/feeds/top", async (c) => {
  const url = new URL(c.req.url);
  const parsed = filterFromUrl(url, "top");
  if ("error" in parsed) return bad(parsed.error);
  return json(await searchSales(c.env.DB, parsed.filter, undefined, url.origin));
});

app.get("/api/feeds/recent", async (c) => {
  const url = new URL(c.req.url);
  const parsed = filterFromUrl(url, "recent");
  if ("error" in parsed) return bad(parsed.error);
  return json(await searchSales(c.env.DB, parsed.filter, parsed.window, url.origin));
});

app.get("/api/domains/*", async (c) => {
  let rest = decodeURIComponent(c.req.path.slice("/api/domains/".length));
  const wantsComps = rest.endsWith("/comps");
  if (wantsComps) rest = rest.slice(0, -"/comps".length);
  rest = rest.replace(/\/+$/, "");
  if (!rest) return bad("Missing domain.");
  const payload = wantsComps ? await domainComps(c.env.DB, rest) : await domainSales(c.env.DB, rest);
  if (!payload) {
    return json({ error: { code: "not_found", message: `No sales for ${rest}.` } }, 404);
  }
  return json(payload);
});

app.get("/domain", (c) => serveSpa(c.req.raw, c.env));
app.get("/domain/*", (c) => serveSpa(c.req.raw, c.env));

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return json({ error: { code: "not_found", message: "No such endpoint." } }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: { code: "internal", message: "Something went wrong." } }, 500);
});

const handler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(rebuildCatalog(env.DB));
  },
} satisfies ExportedHandler<Env>;

export default handler;

function bad(message: string): Response {
  return json({ error: { code: "bad_request", message } }, 400);
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "private, max-age=15" },
  });
}

function keyMatches(expected: string | undefined, given: string): boolean {
  if (!expected || expected.length !== given.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index++) {
    mismatch |= expected.charCodeAt(index) ^ given.charCodeAt(index);
  }
  return mismatch === 0;
}

function serveSpa(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = "/";
  url.search = "";
  return env.ASSETS.fetch(new Request(url.toString(), request));
}
