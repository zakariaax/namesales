export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { accept: "application/json" } });
  const body = (await response.json()) as { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed.");
  return body as T;
}
