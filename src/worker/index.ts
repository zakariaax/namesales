import { Hono } from "hono";
import { domainComps, domainSales, filterFromUrl, healthCount, meta, searchSales } from "./db";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", async (c) => {
  const sales = await healthCount(c.env.DB);
  return json({ ok: true, sales });
});

app.get("/api/meta", async (c) => json(await meta(c.env.DB)));

app.get("/api/search", async (c) => {
  const parsed = filterFromUrl(new URL(c.req.url), "search");
  if ("error" in parsed) return bad(parsed.error);
  return json(await searchSales(c.env.DB, parsed.filter));
});

app.get("/api/feeds/top", async (c) => {
  const parsed = filterFromUrl(new URL(c.req.url), "top");
  if ("error" in parsed) return bad(parsed.error);
  return json(await searchSales(c.env.DB, parsed.filter));
});

app.get("/api/feeds/recent", async (c) => {
  const parsed = filterFromUrl(new URL(c.req.url), "recent");
  if ("error" in parsed) return bad(parsed.error);
  return json(await searchSales(c.env.DB, parsed.filter, parsed.window));
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

export default app;

function bad(message: string): Response {
  return json({ error: { code: "bad_request", message } }, 400);
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "private, max-age=15" },
  });
}

function serveSpa(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = "/";
  url.search = "";
  return env.ASSETS.fetch(new Request(url.toString(), request));
}
