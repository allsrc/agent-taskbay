import { describe, expect, it, vi, afterEach } from "vitest";
import { InProcessFreshness } from "./in-process-freshness";
import { freshnessStream } from "./freshness-stream";

afterEach(() => vi.useRealTimers());
const frame = (value?: Uint8Array) => new TextDecoder().decode(value);

describe("REL-002 application freshness stream", () => {
  it("isolates organizations, re-queries on reconnect, coalesces duplicate publication and bounds lifetime", async () => {
    vi.useFakeTimers();
    const bus = new InProcessFreshness();
    const read = vi.spyOn(bus, "readToken");
    const signal = new AbortController();
    const stream = freshnessStream(bus, "one", signal.signal, { pollMs: 10, resyncMs: 100, lifetimeMs: 500 });
    const reader = stream.getReader();
    expect(frame((await reader.read()).value)).toContain("event: ready");
    await bus.publish("other");
    const next = reader.read();
    await Promise.all([bus.publish("one"), bus.publish("one")]);
    await vi.advanceTimersByTimeAsync(10);
    expect(frame((await next).value)).toContain("event: freshness");
    const resync = reader.read();
    await vi.advanceTimersByTimeAsync(100);
    expect(frame((await resync).value)).toContain("event: resync");
    await reader.cancel();
    const reads = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(200);
    expect(read).toHaveBeenCalledTimes(reads);
    // Any missed signals are recovered by ready, even without cursor/replay.
    await bus.publish("one");
    const reconnected = freshnessStream(bus, "one", signal.signal, { lifetimeMs: 20 }).getReader();
    expect(frame((await reconnected.read()).value)).toContain("event: ready");
    const ending = reconnected.read();
    await vi.advanceTimersByTimeAsync(20);
    expect((await ending).done).toBe(true);
  });

  it("closes on request abort, redacts read failures and stops polling a slow consumer", async () => {
    vi.useFakeTimers();
    const readToken = vi.fn().mockResolvedValue("");
    const abort = new AbortController();
    const stream = freshnessStream({ readToken }, "org", abort.signal, { pollMs: 10 });
    await vi.advanceTimersByTimeAsync(100);
    expect(readToken).toHaveBeenCalledTimes(1); // ready fills the queue; no unbounded production.
    const reader = stream.getReader();
    await reader.read();
    const pending = reader.read();
    abort.abort();
    expect((await pending).done).toBe(true);
    const reads = readToken.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(readToken).toHaveBeenCalledTimes(reads);
    const broken = freshnessStream({ readToken: async () => { throw new Error("secret credential"); } }, "org", new AbortController().signal).getReader();
    await expect(broken.read()).rejects.toThrow("Freshness stream unavailable.");
  });
});
