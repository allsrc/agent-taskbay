const MAX_ENTRIES = 50;
const held = new Map<string, { etag: string; body: unknown }>();

/**
 * GET JSON with `If-None-Match` from a tab-local memory cache. Responses are `no-store`, so the browser
 * keeps nothing; a `304` reuses the body held here. `unchanged` lets callers skip re-rendering.
 */
export async function fetchJson<T>(url: string, signal?: AbortSignal) {
  const previous = held.get(url);
  const response = await fetch(url, { cache: "no-store", signal,
    ...(previous ? { headers: { "If-None-Match": previous.etag } } : {}) });
  if (response.status === 304 && previous) return { ok: true as const, body: previous.body as T, unchanged: true };
  const body = await response.json();
  const etag = response.headers.get("etag");
  if (response.ok && etag) {
    held.delete(url);
    held.set(url, { etag, body });
    if (held.size > MAX_ENTRIES) held.delete(held.keys().next().value as string);
  } else held.delete(url);
  return { ok: response.ok, body: body as T, unchanged: false };
}
