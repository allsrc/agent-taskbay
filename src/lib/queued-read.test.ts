import { describe, expect, it, vi } from "vitest";
import { queuedRead } from "./queued-read";

describe("REL-002 projection re-query", () => {
  it("reads again after signals during a request and coalesces duplicate signals", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    let durable = "working";
    const seen: string[] = [];
    const read = vi.fn(async () => {
      const snapshot = durable;
      if (!seen.length) await hold;
      seen.push(snapshot);
    });
    const refresh = queuedRead(read, new AbortController().signal);
    const first = refresh();
    durable = "input-required";
    await refresh(); await refresh();
    release(); await first;
    expect(seen).toEqual(["working", "input-required"]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("cancels queued refreshes when a consumer unmounts or changes URL", async () => {
    let release!: () => void;
    const abort = new AbortController();
    const read = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const refresh = queuedRead(read, abort.signal);
    const pending = refresh();
    await refresh(); abort.abort(); release(); await pending;
    await refresh();
    expect(read).toHaveBeenCalledTimes(1);
  });
});
