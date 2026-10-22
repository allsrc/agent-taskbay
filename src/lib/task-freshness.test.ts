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

  it("polls (with jitter) only while EventSource is unavailable", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", undefined);
    const listener = vi.fn();
    const leave = subscribeTaskFreshness(listener);
    await vi.advanceTimersByTimeAsync(7_500);
    expect(listener).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(7_500);
    expect(listener).toHaveBeenCalledTimes(2);
    leave();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not poll while the stream is healthy, and polls only after it stalls or fails", async () => {
    vi.useFakeTimers();
    const events = new EventTarget();
    vi.stubGlobal("EventSource", vi.fn(function () { return Object.assign(events, { close: vi.fn() }); }));
    const listener = vi.fn();
    const leave = subscribeTaskFreshness(listener);
    events.dispatchEvent(new Event("ready"));
    for (let i = 0; i < 4; i++) { // Resync frames every 15 s keep the stream healthy.
      await vi.advanceTimersByTimeAsync(15_000);
      events.dispatchEvent(new Event("resync"));
    }
    await vi.advanceTimersByTimeAsync(25);
    expect(listener).toHaveBeenCalledTimes(5); // Signals only, no timer reads.
    events.dispatchEvent(new Event("error")); // Brief reconnect gap: still no polling.
    await vi.advanceTimersByTimeAsync(1_000);
    events.dispatchEvent(new Event("ready"));
    await vi.advanceTimersByTimeAsync(25);
    expect(listener).toHaveBeenCalledTimes(6);
    events.dispatchEvent(new Event("error")); // Stream stays down: fall back to polling.
    await vi.advanceTimersByTimeAsync(5_000 + 7_500);
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(7);
    const during = listener.mock.calls.length;
    events.dispatchEvent(new Event("ready")); // Recovered: polling stops.
    await vi.advanceTimersByTimeAsync(25);
    const after = listener.mock.calls.length;
    expect(after).toBe(during + 1);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(listener).toHaveBeenCalledTimes(after);
    leave();
  });
});
