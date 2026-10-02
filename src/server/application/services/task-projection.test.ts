import { describe, expect, it } from "vitest";
import { canonicalJson, eventDigest } from "./observe-task";
import { taskStorageKey } from "../../../shared/task-types";

describe("REL-001 canonical observation identity", () => {
  it("ignores object property order and preserves array order", () => {
    expect(eventDigest({ b: 2, a: { y: 1, x: 0 } })).toBe(eventDigest({ a: { x: 0, y: 1 }, b: 2 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
  it("scopes browser cache keys by agent and tenant until a local UUID arrives", () => {
    const base = { taskId: "same", agentId: "one", agentName: "One", state: "WORKING", createdAt: "t", updatedAt: "t", messages: [], artifacts: [] };
    expect(taskStorageKey(base)).not.toBe(taskStorageKey({ ...base, agentId: "two" }));
    expect(taskStorageKey(base)).not.toBe(taskStorageKey({ ...base, tenant: "two" }));
    expect(taskStorageKey({ ...base, localId: "local" })).toBe("local");
  });
});
