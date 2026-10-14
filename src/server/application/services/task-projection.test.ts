import { describe, expect, it } from "vitest";
import { canonicalJson, eventDigest } from "./observe-task";
import { projectTaskEvent } from "./task-projection";
import type { DurableTaskView } from "../../../shared/task-types";
import type { JsonValue } from "../../domain/persistence-model";
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

describe("status message projection", () => {
  it("preserves the status envelope author on its nested message", () => {
    const base = {
      taskId: "remote", localId: "local", tenant: "", agentId: "agent", agentName: "Agent", kind: "task",
      state: "TASK_STATE_WORKING", createdAt: "", updatedAt: "", messages: [], artifacts: [], referenceLinks: {},
    } as unknown as DurableTaskView;
    const event = {
      statusUpdate: {
        taskId: "remote", contextId: "context",
        status: {
          state: "TASK_STATE_WORKING", timestamp: "2026-10-14T14:07:52.053043Z",
          message: { messageId: "message-1", role: "ROLE_AGENT", parts: [{ data: { id: "call-1", name: "list_directory", args: {} }, mediaType: "application/json", metadata: { adk_type: "function_call" } }] },
        },
        metadata: { adk_author: "knowledge_agent" },
      },
    } as unknown as JsonValue;
    const projected = projectTaskEvent(base, event, "2026-10-14T14:07:52.053043Z", "event-1");
    expect(projected.messages[0]).toMatchObject({ fromStatus: true, metadata: { adk_author: "knowledge_agent" } });
  });
});
