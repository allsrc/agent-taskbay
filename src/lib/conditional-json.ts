import { createHash } from "node:crypto";

const opaque = (tag: string) => tag.trim().replace(/^W\//, "");

/**
 * JSON response with a weak ETag of its body, answering `304` when the caller already holds it.
 * Responses stay `no-store`; clients revalidate by hand from memory (see conditional-fetch.ts).
 */
export function conditionalJson(request: Request, body: unknown) {
  const text = JSON.stringify(body);
  const etag = `W/"${createHash("sha256").update(text).digest("base64url").slice(0, 27)}"`;
  const headers = { "Cache-Control": "no-store", ETag: etag };
  const held = request.headers.get("if-none-match");
  if (held && (held.trim() === "*" || held.split(",").some((tag) => opaque(tag) === opaque(etag)))) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(text, { headers: { ...headers, "Content-Type": "application/json" } });
}
