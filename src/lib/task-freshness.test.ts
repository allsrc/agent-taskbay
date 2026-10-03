import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeTaskFreshness } from "./task-freshness";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("REL-002 browser freshness", () => {
  it("shares one connection, coalesces duplicates and notifies every reader on reconnect/resync", async () => {
    vi.useFakeTimers();
    const events = new EventTarget();
    const close = vi.fn();
    const EventSource = vi.fn(function () { return Object.assign(events, { close }); });
    vi.stubGlobal("EventSource", EventSource);
    const one = vi.fn(); const two = vi.fn();
    const leaveOne = subscribeTaskFreshness(one); const leaveTwo = subscribeTaskFreshness(two);
    expect(EventSource).toHaveBeenCalledExactlyOnceWith("/api/tasks/events");
    for (const name of ["ready", "freshness", "freshness"]) events.dispatchEvent(new Event(name));
    await vi.advanceTimersByTimeAsync(25);
    expect(one).toHaveBeenCalledTimes(1); expect(two).toHaveBeenCalledTimes(1);
    events.dispatchEvent(new Event("ready")); // Automatic EventSource reconnect.
    await vi.advanceTimersByTimeAsync(25);
    expect(one).toHaveBeenCalledTimes(2);
    leaveOne(); expect(close).not.toHaveBeenCalled();
    events.dispatchEvent(new Event("resync"));
    await vi.advanceTimersByTimeAsync(25);
    expect(one).toHaveBeenCalledTimes(2); expect(two).toHaveBeenCalledTimes(3);
    events.dispatchEvent(new Event("freshness"));
    leaveTwo(); expect(close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(25);
    expect(two).toHaveBeenCalledTimes(3);
  });

  it("allows periodic/focus reads when EventSource is unavailable", () => {
    vi.stubGlobal("EventSource", undefined);
    const leave = subscribeTaskFreshness(vi.fn());
    leave();
  });
});
