interface CountHit {
  total: number;
  exact: boolean;
}

const TTL_MS = 60_000;
const memory = new Map<string, { at: number; value: CountHit }>();
let generation = 1;

/** Drop cached match counts after a stats refresh so the next search recounts. */
export function clearCountCache(): void {
  generation += 1;
  memory.clear();
}

export async function cachedCount(origin: string | undefined, rawKey: string, load: () => Promise<CountHit>): Promise<CountHit> {
  const key = `${generation}:${rawKey}`;
  const now = Date.now();
  const remembered = memory.get(key);
  if (remembered && now - remembered.at < TTL_MS) return remembered.value;

  const fromEdge = await readEdge(origin, key);
  if (fromEdge) {
    remember(key, fromEdge, now);
    return fromEdge;
  }

  const value = await load();
  remember(key, value, now);
  await writeEdge(origin, key, value);
  return value;
}

function remember(key: string, value: CountHit, at: number): void {
  if (memory.size > 200) {
    const oldest = memory.keys().next().value;
    if (oldest) memory.delete(oldest);
  }
  memory.set(key, { at, value });
}

async function readEdge(origin: string | undefined, key: string): Promise<CountHit | null> {
  if (!origin || typeof caches === "undefined") return null;
  try {
    const cached = await caches.default.match(cacheRequest(origin, key));
    if (!cached) return null;
    const body = (await cached.json()) as CountHit;
    if (typeof body.total !== "number" || typeof body.exact !== "boolean") return null;
    return body;
  } catch {
    return null;
  }
}

async function writeEdge(origin: string | undefined, key: string, value: CountHit): Promise<void> {
  if (!origin || typeof caches === "undefined") return;
  try {
    await caches.default.put(
      cacheRequest(origin, key),
      new Response(JSON.stringify(value), {
        headers: { "cache-control": "public, max-age=60", "content-type": "application/json" },
      }),
    );
  } catch {
    /* The in-isolate map still serves this worker. */
  }
}

function cacheRequest(origin: string, key: string): Request {
  const url = new URL("/__namesales_count", origin);
  url.searchParams.set("k", key);
  return new Request(url.toString(), { method: "GET" });
}
