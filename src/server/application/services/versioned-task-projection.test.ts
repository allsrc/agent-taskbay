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

describe("WF-25 repeated status updates with the same state", () => {
  const working = (text: string, timestamp?: string): JsonValue => ({ statusUpdate: { taskId: "remote", status: {
    state: "TASK_STATE_WORKING", ...(timestamp ? { timestamp } : {}), message: { messageId: `m-${text}`, role: "ROLE_AGENT", parts: [{ text }] } } } });
  const texts = (view: ReturnType<typeof reduceTaskLedger>) => view.messages.map((message) => message.parts.map((part) => String(part.value)).join(""));

  it("keeps every message, in order, when each update carries its own timestamp", () => {
    const view = reduceTaskLedger(task, "Agent", [
      row(1, working("Reading documents", "2026-10-03T00:00:01Z")), row(2, working("Analyzing APIs", "2026-10-03T00:00:02Z")),
      row(3, working("Validating security", "2026-10-03T00:00:03Z")),
    ]);
    expect(texts(view)).toEqual(["Reading documents", "Analyzing APIs", "Validating security"]);
    expect(view.state).toBe("TASK_STATE_WORKING");
    expect(view.transitions?.filter((transition) => transition.state === "TASK_STATE_WORKING").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps every message when updates have no timestamp, and records one working transition per turn", () => {
    const view = reduceTaskLedger(task, "Agent", [row(1, working("Reading documents")), row(2, working("Analyzing APIs")), row(3, working("Validating security"))]);
    expect(texts(view)).toEqual(["Reading documents", "Analyzing APIs", "Validating security"]);
    expect(view.transitions?.filter((transition) => transition.state === "TASK_STATE_WORKING")).toHaveLength(1);
  });

  it("is the same when the ledger is read in another order", () => {
    const events = [row(1, working("a", "2026-10-03T00:00:01Z")), row(2, working("b", "2026-10-03T00:00:02Z")), row(3, working("c"))];
    expect(reduceTaskLedger(task, "Agent", events.toReversed())).toEqual(reduceTaskLedger(task, "Agent", events));
  });

  it("does not let a repeated identical update duplicate its message", () => {
    const view = reduceTaskLedger(task, "Agent", [row(1, working("same", "2026-10-03T00:00:01Z")), row(2, working("same", "2026-10-03T00:00:01Z"), "webhook")]);
    expect(texts(view)).toEqual(["same"]);
  });
});

describe("messages that only the agent's loaded history carries", () => {
  const msg = (id: string, role = "ROLE_AGENT") => ({ messageId: id, role, parts: [{ text: `text ${id}` }] });
  const snapshot = (ids: string[], state = "TASK_STATE_WORKING"): JsonValue => ({ task: { id: "remote", status: { state }, history: ids.map((id) => msg(id, id.startsWith("u") ? "ROLE_USER" : "ROLE_AGENT")) } });
  const loaded = (sequence: number, event: JsonValue): TaskEventRecord => {
    const base = row(sequence, event, "reconcile");
    return { ...base, payloadJson: { event, projectionContext: { turnId: "no-user", historyRefresh: true } } };
  };
  const origins = (view: ReturnType<typeof reduceTaskLedger>) => Object.fromEntries(view.messages.map((message) => [message.id, message.origin ?? "received"]));

  it("labels only the messages nothing else carried, and leaves what was received live alone", () => {
    const live: JsonValue = { statusUpdate: { taskId: "remote", status: { state: "TASK_STATE_WORKING", message: msg("a3") } } };
    const view = reduceTaskLedger(task, "Agent", [row(1, { message: { ...msg("u1", "ROLE_USER"), taskId: "remote" } }, "command_response"), row(2, live, "stream"),
      loaded(3, snapshot(["u1", "a1", "a2", "a3", "a4"]))]);
    expect(origins(view)).toEqual({ u1: "received", a3: "received", a1: "agent-history", a2: "agent-history", a4: "agent-history" });
  });

  it("is stable when the history is loaded again and when the ledger is rebuilt in another order", () => {
    const events = [row(1, snapshot(["a1"])), loaded(2, snapshot(["a1", "a2", "a3"])), loaded(3, snapshot(["a1", "a2", "a3"], "TASK_STATE_COMPLETED"))];
    const view = reduceTaskLedger(task, "Agent", events);
    expect(origins(view)).toEqual({ a1: "received", a2: "agent-history", a3: "agent-history" });
    expect(reduceTaskLedger(task, "Agent", events.toReversed())).toEqual(view);
  });

  it("does not relabel a message when Taskbay's own re-read carries it, but a live delivery makes it received", () => {
    const base = [loaded(1, snapshot(["a1", "a2"]))];
    const reread = reduceTaskLedger(task, "Agent", [...base, row(2, snapshot(["a1", "a2"], "TASK_STATE_COMPLETED"), "reconcile")]);
    expect(origins(reread)).toEqual({ a1: "agent-history", a2: "agent-history" });
    const delivered = reduceTaskLedger(task, "Agent", [...base, row(2, { message: { ...msg("a2"), taskId: "remote" } }, "stream")]);
    expect(origins(delivered)).toEqual({ a1: "agent-history", a2: "received" });
  });

  it("does not label the status message of the task, which the agent is saying now", () => {
    const current: JsonValue = { task: { id: "remote", status: { state: "TASK_STATE_INPUT_REQUIRED", message: msg("ask") }, history: [msg("a1")] } };
    expect(origins(reduceTaskLedger(task, "Agent", [loaded(1, current)]))).toEqual({ a1: "agent-history", ask: "received" });
  });
});
