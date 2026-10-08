import { describe, expect, it } from "vitest";
import { isActiveState, needsYou, shortTaskId, stateName } from "./task-view";

describe("task-view", () => {
  describe("shortTaskId", () => {
    it("preserves empty string", () => {
      expect(shortTaskId("")).toBe("");
    });

    it("preserves short task IDs without truncating", () => {
      expect(shortTaskId("form-task-0")).toBe("form-task-0");
      expect(shortTaskId("task-12345")).toBe("task-12345");
    });

    it("truncates long task IDs with ellipsis", () => {
      expect(shortTaskId("01234567-89ab-cdef-0123-456789abcdef")).toBe("01234567…");
    });

    it("respects custom max length", () => {
      expect(shortTaskId("short-id", 5)).toBe("short-id".slice(0, 8) + "…");
      expect(shortTaskId("tiny", 5)).toBe("tiny");
    });
  });

  describe("state helpers", () => {
    it("extracts state name properly", () => {
      expect(stateName("TASK_STATE_WORKING")).toBe("WORKING");
      expect(stateName("WORKING")).toBe("WORKING");
    });

    it("identifies active and waiting states", () => {
      expect(isActiveState("TASK_STATE_WORKING")).toBe(true);
      expect(isActiveState("TASK_STATE_COMPLETED")).toBe(false);
      expect(needsYou("TASK_STATE_INPUT_REQUIRED")).toBe(true);
      expect(needsYou("TASK_STATE_WORKING")).toBe(false);
    });
  });
});
