import { describe, expect, it } from "vitest";
import { DISCOVERED_NOTIFY_WINDOW_MS, suppressFirstSight } from "./observe-task";

const now = new Date("2026-10-10T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const FIRST = "TASK_STATE_UNSPECIFIED";
const HOUR = 3_600_000;

describe("suppressFirstSight (a task found on the agent is not news)", () => {
  it("never suppresses a task started from Taskbay, or any later change", () => {
    expect(suppressFirstSight({}, FIRST, "INPUT_REQUIRED", ago(0), now)).toBe(false);
    expect(suppressFirstSight({ origin: "created" }, FIRST, "INPUT_REQUIRED", ago(0), now)).toBe(false);
    expect(suppressFirstSight({ origin: "discovered", trackedByUserId: "u" }, "TASK_STATE_WORKING", "INPUT_REQUIRED", ago(0), now)).toBe(false);
    expect(suppressFirstSight({ origin: "discovered", trackedByUserId: null }, "TASK_STATE_WORKING", "COMPLETED", ago(0), now)).toBe(false);
  });

  it("suppresses everything on first sight of a task a person tracked", () => {
    for (const state of ["INPUT_REQUIRED", "AUTH_REQUIRED", "COMPLETED", "FAILED", "WORKING"])
      expect(suppressFirstSight({ origin: "discovered", trackedByUserId: "u" }, FIRST, state, ago(0), now), state).toBe(true);
  });

  it.each([
    ["INPUT_REQUIRED", 0, false], ["AUTH_REQUIRED", 2 * HOUR, false], ["INPUT_REQUIRED", DISCOVERED_NOTIFY_WINDOW_MS, false],
    ["INPUT_REQUIRED", DISCOVERED_NOTIFY_WINDOW_MS + 1, true], ["INPUT_REQUIRED", 48 * HOUR, true],
    ["COMPLETED", 0, true], ["FAILED", 0, true], ["CANCELED", 0, true], ["REJECTED", 0, true], ["WORKING", 0, true], ["SUBMITTED", 0, true],
  ])("automatic discovery, %s last updated %d ms ago: suppressed is %s", (state, age, suppressed) => {
    expect(suppressFirstSight({ origin: "discovered", trackedByUserId: null }, FIRST, state, ago(age), now)).toBe(suppressed);
  });

  it("suppresses a waiting task when the agent gave no time at all", () => {
    expect(suppressFirstSight({ origin: "discovered", trackedByUserId: null }, FIRST, "INPUT_REQUIRED", null, now)).toBe(true);
  });
});
