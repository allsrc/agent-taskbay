import { describe, expect, it } from "vitest";
import { IdempotencyKeys, canDecide, executionSummary, expiryLabel, isExpired, isOpen, shortDigest } from "./approvals";

const NOW = Date.parse("2026-10-05T12:00:00Z");
describe("approval helpers", () => {
  it("labels time to expiry and expired state", () => {
    expect(expiryLabel("2026-10-05T12:30:00Z", NOW)).toBe("Expires in 30m");
    expect(expiryLabel("2026-10-05T14:05:00Z", NOW)).toBe("Expires in 2h 5m");
    expect(expiryLabel("2026-10-05T12:00:20Z", NOW)).toBe("Expires in less than a minute");
    expect(expiryLabel("2026-10-05T11:45:00Z", NOW)).toBe("Expired 15m ago");
    expect(expiryLabel("2026-10-12T12:00:00Z", NOW)).toBe("Expires in 7d");
  });
  it("only lets a pending, unexpired request be decided", () => {
    expect(canDecide("pending", "2026-10-05T13:00:00Z", NOW)).toBe(true);
    expect(canDecide("pending", "2026-10-05T12:00:00Z", NOW)).toBe(false);
    for (const status of ["approved", "rejected", "changes_requested", "expired", "superseded"] as const) expect(canDecide(status, "2026-10-06T00:00:00Z", NOW)).toBe(false);
    expect(isExpired("2026-10-05T11:59:59Z", NOW)).toBe(true);
    expect([isOpen("pending"), isOpen("changes_requested"), isOpen("approved")]).toEqual([true, true, false]);
  });
  it("summarizes delivery honestly, including the unknown outcome", () => {
    expect(executionSummary({ status: "pending", observedTaskState: null, error: null })).toBe("Queued to send to the agent");
    expect(executionSummary({ status: "succeeded", observedTaskState: "TASK_STATE_COMPLETED", error: null })).toBe("Delivered to the agent; task is now COMPLETED");
    expect(executionSummary({ status: "uncertain", observedTaskState: null, error: null })).toMatch(/not resent automatically/);
  });
  it("reuses a key for an identical retry and issues a new key for changed input", () => {
    let count = 0;
    const keys = new IdempotencyKeys(() => `key-${++count}`);
    expect(keys.keyFor("approve:1:")).toBe("key-1");
    expect(keys.keyFor("approve:1:")).toBe("key-1");
    expect(keys.keyFor("reject:1:too risky")).toBe("key-2");
    keys.clear();
    expect(keys.keyFor("approve:1:")).toBe("key-3");
  });
  it("shortens digests for display", () => expect(shortDigest("a".repeat(64))).toHaveLength(12));
});
