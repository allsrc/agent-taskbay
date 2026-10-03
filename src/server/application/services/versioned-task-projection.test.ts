import { describe, expect, it } from "vitest";
import type { JsonValue, TaskEventRecord, TaskRecord } from "../../domain/persistence-model";
import { eventDigest } from "./event-identity";
import { reduceTaskLedger } from "./versioned-task-projection";

const task: TaskRecord = {
  id: "local", organizationId: "org", agentId: "agent", tenant: "tenant", remoteTaskId: "remote", remoteContextId: null,
  kind: "task", state: "CORRUPT", title: "CORRUPT", createdAt: new Date(0), updatedAt: new Date(0),
  remoteCreatedAt: null, remoteUpdatedAt: null, ownerUserId: null, ownerTeamId: null, terminalAt: null, version: 1,
  contentJson: { messages: [{ id: "corrupt" }] },
};
function row(sequence: number, event: JsonValue, source: TaskEventRecord["source"] = "stream", turn = "no-user"): TaskEventRecord {
  const subject = event as { task?: { status: { timestamp?: string } }; statusUpdate?: { status: { timestamp?: string } } };
  const timestamp = subject.task?.status.timestamp ?? subject.statusUpdate?.status.timestamp;
  return { id: String(sequence), sequence, taskId: task.id, organizationId: task.organizationId, agentId: task.agentId,
    source, sourceKey: String(sequence), eventKind: "task", receivedAt: new Date(sequence * 1000), remoteTimestamp: timestamp ? new Date(timestamp) : null,
    payloadDigest: eventDigest(event), payloadJson: { event, projectionContext: { turnId: turn } }, projectionVersion: 2,
    sessionId: null, requestId: null, traceId: null };
}
const append = (text = "ha"): JsonValue => ({ artifactUpdate: { taskId: "remote", artifact: { artifactId: "text", parts: [{ text }] }, append: true } });
describe("REL-001/003 versioned ledger projection", () => {
  it("uses ledger sequence and scoped turn occurrences across event sources", () => {
    const events = [row(1, append()), row(2, append()), row(3, append(), "webhook"), row(4, append(), "webhook"), row(5, append(), "stream", "new-turn")];
    const first = reduceTaskLedger(task, "Agent", events);
    expect(first.artifacts[0]).toMatchObject({ parts: [{ value: "hahaha" }], updateCount: 3 });
    expect(reduceTaskLedger(task, "Agent", events.toReversed())).toEqual(first);
    expect(first.messages).toEqual([]);
    expect(first.title).toBeUndefined();
  });
  it("converges history and status messages without remote IDs across dialects", () => {
    const history: JsonValue = { task: { id: "remote", status: { state: "TASK_STATE_INPUT_REQUIRED" }, history: [
      { role: "ROLE_AGENT", parts: [{ text: "Earlier" }] }, { role: "ROLE_AGENT", parts: [{ text: "Continue?" }] },
    ] } };
    const prompt: JsonValue = { statusUpdate: { taskId: "remote", status: { state: "TASK_STATE_INPUT_REQUIRED", message: { role: "agent", parts: [{ kind: "text", text: "Continue?" }] } } } };
    const view = reduceTaskLedger(task, "Agent", [row(1, history), row(2, prompt, "webhook")]);
    expect(view.messages).toHaveLength(2);
    expect(view.messages[0].fromStatus).toBeFalsy();
    expect(view.messages[1].fromStatus).toBe(true);
    expect(view.transitions).toHaveLength(1);
  });
  it("rejects stale full snapshots and terminal regression while retaining valid artifacts", () => {
    const events = [
      row(1, { task: { id: "remote", status: { state: "TASK_STATE_COMPLETED", timestamp: "2026-10-03T00:00:02Z" }, artifacts: [{ artifactId: "text", parts: [{ text: "Final" }] }] } }),
      row(2, { task: { id: "remote", status: { state: "TASK_STATE_WORKING", timestamp: "2026-10-03T00:00:01Z" }, artifacts: [{ artifactId: "text", parts: [{ text: "Stale" }] }] } }),
      row(3, { statusUpdate: { taskId: "remote", status: { state: "TASK_STATE_WORKING" } } }),
    ];
    expect(reduceTaskLedger(task, "Agent", events)).toMatchObject({ state: "TASK_STATE_COMPLETED", artifacts: [{ parts: [{ value: "Final" }] }], transitions: [{ state: "TASK_STATE_COMPLETED" }] });
  });
  it("re-arms a timestamped prompt through an untimestamped command response and corrects later chunks", () => {
    const events = [
      row(1, { task: { id: "remote", status: { state: "TASK_STATE_INPUT_REQUIRED", timestamp: "2026-10-03T00:00:01Z" }, artifacts: [{ artifactId: "text", parts: [{ text: "Snapshot" }] }] } }),
      row(2, { task: { id: "remote", status: { state: "TASK_STATE_WORKING" } } }, "command_response", "reply"),
      row(3, append(" Extra"), "stream", "reply"),
      row(4, { task: { id: "remote", status: { state: "TASK_STATE_WORKING" }, artifacts: [{ artifactId: "text", parts: [{ text: "Snapshot" }] }] } }, "reconcile", "reply"),
    ];
    expect(reduceTaskLedger(task, "Agent", events)).toMatchObject({ state: "TASK_STATE_WORKING", artifacts: [{ parts: [{ value: "Snapshot" }] }] });
  });
  it("fails closed for foreign ledger/task/tenant identities", () => {
    const valid = row(1, { task: { id: "remote", status: { state: "TASK_STATE_WORKING" } } });
    for (const field of ["organizationId", "agentId", "taskId"]) expect(() => reduceTaskLedger(task, "Agent", [{ ...valid, [field]: "foreign" }])).toThrow("scope mismatch");
    expect(() => reduceTaskLedger(task, "Agent", [row(1, { task: { id: "foreign", status: { state: "TASK_STATE_WORKING" } } })])).toThrow("remote identity");
    expect(() => reduceTaskLedger(task, "Agent", [row(1, { task: { id: "remote", tenant: "foreign", status: { state: "TASK_STATE_WORKING" } } })])).toThrow("tenant");
    expect(() => reduceTaskLedger({ ...task, remoteContextId: "context" }, "Agent", [row(1, { task: { id: "remote", contextId: "foreign", status: { state: "TASK_STATE_WORKING" } } })])).toThrow("context");
  });
});
