import { afterEach, describe, expect, it, vi } from "vitest";
import { conditionalJson } from "./conditional-json";
import { fetchJson } from "./conditional-fetch";

afterEach(() => vi.unstubAllGlobals());

describe("conditional JSON reads", () => {
  it("answers 304 only for the body the caller holds, and stays no-store", async () => {
    const first = conditionalJson(new Request("http://x/a"), { n: 1 });
    const etag = first.headers.get("etag")!;
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toEqual({ n: 1 });
    const same = conditionalJson(new Request("http://x/a", { headers: { "If-None-Match": `"other", ${etag}` } }), { n: 1 });
    expect(same.status).toBe(304); expect(same.headers.get("cache-control")).toBe("no-store");
    expect(await same.text()).toBe("");
    const changed = conditionalJson(new Request("http://x/a", { headers: { "If-None-Match": etag } }), { n: 2 });
    expect(changed.status).toBe(200); expect(changed.headers.get("etag")).not.toBe(etag);
  });

  it("revalidates from memory, reuses the body on 304 and drops entries after errors", async () => {
    const calls: Array<RequestInit | undefined> = [];
    const responses = [
      () => new Response(JSON.stringify({ n: 1 }), { headers: { ETag: 'W/"v1"' } }),
      () => new Response(null, { status: 304, headers: { ETag: 'W/"v1"' } }),
      () => new Response(JSON.stringify({ error: { message: "down" } }), { status: 503 }),
      () => new Response(JSON.stringify({ n: 1 }), { headers: { ETag: 'W/"v1"' } }),
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => { calls.push(init); return responses.shift()!(); }));
    expect(await fetchJson("/api/held")).toEqual({ ok: true, body: { n: 1 }, unchanged: false });
    expect(await fetchJson("/api/held")).toEqual({ ok: true, body: { n: 1 }, unchanged: true });
    expect(calls[1]).toMatchObject({ cache: "no-store", headers: { "If-None-Match": 'W/"v1"' } });
    expect((await fetchJson("/api/held")).ok).toBe(false);
    await fetchJson("/api/held");
    expect(calls[3]).not.toHaveProperty("headers"); // Nothing is held after a failure.
  });
});
