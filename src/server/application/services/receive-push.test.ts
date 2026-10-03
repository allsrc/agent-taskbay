import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../../domain/persistence-model";
import { validatePushEvent } from "./receive-push";
const task = { remoteTaskId: "expected", tenant: "tenant-one", remoteContextId: "context-one" } as TaskRecord;
describe("TSK-003 SEC-005 expected-task push payloads", () => {
  it("accepts canonical updates and explicit v0.3 snapshots", () => {
    const event = { statusUpdate: { taskId: "expected", contextId: "context-one", status: { state: "TASK_STATE_INPUT_REQUIRED" } } };
    expect(validatePushEvent(event, task)).toEqual(event);
    expect(validatePushEvent({ kind: "task", id: "expected", status: { state: "input-required" } }, task))
      .toEqual({ task: { id: "expected", status: { state: "TASK_STATE_INPUT_REQUIRED" } } });
  });
  it("rejects malformed unions, foreign task/tenant/context and nested routing identities", () => {
    for (const input of [null, {}, { task: {}, message: {} }, { message: { messageId: "direct", role: "ROLE_AGENT", parts: [] } },
      { task: { id: "foreign", status: { state: "TASK_STATE_WORKING" } } },
      { statusUpdate: { taskId: "expected", status: { state: "not-a-state" } } },
      { statusUpdate: { taskId: "expected", tenant: "other", status: { state: "TASK_STATE_WORKING" } } },
      { statusUpdate: { taskId: "expected", contextId: "other", status: { state: "TASK_STATE_WORKING" } } },
      { task: { id: "expected", status: { state: "TASK_STATE_WORKING" }, history: [{ messageId: "x", role: "ROLE_AGENT", taskId: "foreign", parts: [] }] } },
    ]) expect(() => validatePushEvent(input, task)).toThrow();
  });
});
