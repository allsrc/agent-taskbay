import { describe, expect, it } from "vitest";
import type { JsonValue } from "../../domain/persistence-model";
import { AGENT_LIMIT, FIRST_SWEEP_LIMIT, FULL_SWEEP_EVERY_MS, SKEW_MS, SWEEP_LIMIT, judgeDiscovered, planSweep } from "./discover-tasks";

const now = new Date("2026-10-10T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const task = (state: string, timestamp?: string, extra: Record<string, unknown> = {}): JsonValue => ({ task: { id: "t", contextId: "c", status: { state, ...(timestamp ? { timestamp } : {}) }, ...extra } }) as JsonValue;
const judge = (event: JsonValue, extra: Partial<Parameters<typeof judgeDiscovered>[1]> = {}) =>
  judgeDiscovered(event, { tenant: "", now, historyDays: 7, sweepFound: 0, sweepLimit: SWEEP_LIMIT, total: 0, ...extra });

describe("planSweep", () => {
  it("reads everything the first time and when the last full read is an hour old", () => {
    expect(planSweep({ lastFullSweepAt: null, lastSyncedAt: null }, now)).toEqual({ full: true, after: null });
    expect(planSweep({ lastFullSweepAt: new Date(now.getTime() - FULL_SWEEP_EVERY_MS), lastSyncedAt: now }, now)).toEqual({ full: true, after: null });
    expect(planSweep({ lastFullSweepAt: now, lastSyncedAt: null }, now)).toEqual({ full: true, after: null });
  });
  it("otherwise asks only for what changed since the last read, with a margin for clock skew", () => {
    const lastSyncedAt = new Date(now.getTime() - 60_000);
    expect(planSweep({ lastFullSweepAt: new Date(now.getTime() - 10 * 60_000), lastSyncedAt }, now)).toEqual({ full: false, after: new Date(lastSyncedAt.getTime() - SKEW_MS) });
  });
});

describe("judgeDiscovered", () => {
  it("stores a working or waiting task whatever its age", () => {
    for (const state of ["TASK_STATE_WORKING", "TASK_STATE_SUBMITTED", "TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED"]) {
      expect(judge(task(state, ago(400))), state).toEqual({ store: true });
      expect(judge(task(state)), state).toEqual({ store: true });
    }
  });
  it("stores a finished task only inside the history window", () => {
    expect(judge(task("TASK_STATE_COMPLETED", ago(1)))).toEqual({ store: true });
    expect(judge(task("TASK_STATE_FAILED", ago(7)))).toEqual({ store: true });
    expect(judge(task("TASK_STATE_COMPLETED", ago(8)))).toEqual({ store: false, reason: "history" });
    expect(judge(task("TASK_STATE_CANCELED", ago(30)))).toEqual({ store: false, reason: "history" });
  });
  it("leaves a finished task alone when its time is unknown, or when history is turned off", () => {
    expect(judge(task("TASK_STATE_COMPLETED"))).toEqual({ store: false, reason: "history" });
    expect(judge(task("TASK_STATE_COMPLETED", "not a time"))).toEqual({ store: false, reason: "history" });
    expect(judge(task("TASK_STATE_COMPLETED", ago(0)), { historyDays: 0 })).toEqual({ store: false, reason: "history" });
    expect(judge(task("TASK_STATE_WORKING"), { historyDays: 0 })).toEqual({ store: true });
  });
  it("stops at the per-sweep limit and the per-agent limit", () => {
    expect(judge(task("TASK_STATE_WORKING"), { sweepFound: SWEEP_LIMIT - 1 })).toEqual({ store: true });
    expect(judge(task("TASK_STATE_WORKING"), { sweepFound: SWEEP_LIMIT })).toEqual({ store: false, reason: "sweep_limit" });
    expect(judge(task("TASK_STATE_WORKING"), { sweepFound: SWEEP_LIMIT, sweepLimit: FIRST_SWEEP_LIMIT })).toEqual({ store: true });
    expect(judge(task("TASK_STATE_WORKING"), { total: AGENT_LIMIT - 1 })).toEqual({ store: true });
    expect(judge(task("TASK_STATE_WORKING"), { total: AGENT_LIMIT })).toEqual({ store: false, reason: "agent_limit" });
  });
  it("refuses what is not a well-formed task for this tenant", () => {
    const invalid = { store: false, reason: "invalid" };
    expect(judge({ message: { messageId: "m" } } as JsonValue)).toEqual(invalid);
    expect(judge(task("TASK_STATE_NOPE"))).toEqual(invalid);
    expect(judge({ task: { id: "t", status: {} } } as JsonValue)).toEqual(invalid);
    expect(judge({ task: { id: "x".repeat(513), status: { state: "TASK_STATE_WORKING" } } } as JsonValue)).toEqual(invalid);
    expect(judge(task("TASK_STATE_WORKING", undefined, { tenant: "other" }))).toEqual(invalid);
    expect(judge(task("TASK_STATE_WORKING", undefined, { tenant: "mine" }), { tenant: "mine" })).toEqual({ store: true });
  });
});
