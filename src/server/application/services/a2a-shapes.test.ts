import { describe, expect, it } from "vitest";
import { isActivityArtifact, planMessages, settleArtifacts } from "../../../lib/chat-activity";
import { isActiveState } from "../../../lib/task-view";
import type { DurableTaskView } from "../../../shared/task-types";
import type { JsonValue, TaskEventRecord, TaskRecord } from "../../domain/persistence-model";
import { eventDigest } from "./event-identity";
import { reduceTaskLedger } from "./versioned-task-projection";

// A2A lets an agent deliver its work in many shapes: a direct Message, history, status messages in any state, standalone
// messages inside a task, artifacts in chunks or replaced. Each case runs real events through the ledger reducer and then
// asks what the chat shows: the reply, the progress log, the activity log and the results.

const record = (kind: "task" | "message" = "task"): TaskRecord => ({
  id: "local", organizationId: "org", agentId: "agent", tenant: "", remoteTaskId: kind === "task" ? "t" : null, remoteContextId: null,
  kind, state: "", title: null, createdAt: new Date(0), updatedAt: new Date(0), remoteCreatedAt: null, remoteUpdatedAt: null,
  ownerUserId: null, ownerTeamId: null, terminalAt: null, version: 1, contentJson: {},
});

let clock = 0;
const at = () => new Date(Date.UTC(2026, 9, 14, 12, 0, ++clock)).toISOString();
const rows = (events: unknown[]): TaskEventRecord[] => (events as JsonValue[]).map((event, index) => ({
  id: String(index + 1), sequence: index + 1, taskId: "local", organizationId: "org", agentId: "agent", source: "stream", sourceKey: String(index + 1),
  eventKind: "task", receivedAt: new Date((index + 1) * 1000), remoteTimestamp: null, payloadDigest: eventDigest(event),
  payloadJson: { event, projectionContext: { turnId: "turn" } }, projectionVersion: 2, sessionId: null, requestId: null, traceId: null,
}));

const user = { messageId: "u", role: "ROLE_USER", parts: [{ text: "Do the thing" }] };
const agent = (id: string | undefined, parts: unknown[]) => ({ ...(id ? { messageId: id } : {}), role: "ROLE_AGENT", parts });
const text = (value: string) => ({ text: value });
const start = { task: { id: "t", contextId: "c", status: { state: "TASK_STATE_WORKING", timestamp: at() }, history: [user] } };
const status = (state: string, message?: unknown, metadata?: unknown) =>
  ({ statusUpdate: { taskId: "t", contextId: "c", status: { state: `TASK_STATE_${state}`, timestamp: at(), ...(message ? { message } : {}) }, ...(metadata ? { metadata } : {}) } });
const artifact = (artifactId: string, parts: unknown[], extra: Record<string, unknown> = {}) =>
  ({ artifactUpdate: { taskId: "t", contextId: "c", artifact: { artifactId, parts }, ...extra } });

/** What the chat shows for a task, using the same functions as the chat view. */
function shown(events: unknown[], kind: "task" | "message" = "task") {
  const view: DurableTaskView = reduceTaskLedger(record(kind), "Agent", rows(events));
  const settled = settleArtifacts(view.artifacts, view.kind !== "message" && !isActiveState(view.state));
  const results = settled.filter((item) => !isActivityArtifact(item));
  const { activityMessages, isUpdate, repeated } = planMessages(view, results);
  const textOf = (message: DurableTaskView["messages"][number]) => message.parts.map((part) => typeof part.value === "string" ? part.value : JSON.stringify(part.value)).join(" ");
  const last = view.messages.length - 1;
  const activityIds = new Set(activityMessages.map((message) => message.id));
  return {
    view,
    said: view.messages.filter((message, index) => message.role === "agent" && !activityIds.has(message.id) && !isUpdate(index) && !(repeated && index === last)).map(textOf),
    progress: view.messages.filter((_, index) => isUpdate(index)).map(textOf),
    activity: activityMessages.map(textOf),
    results: results.map((item) => item.parts.map((part) => part.value).join("")),
  };
}

describe("A2A delivery shapes in chat", () => {
  it("a direct Message reply", () => {
    const seen = shown([{ message: { ...agent("m", [text("Hello there")]), contextId: "c" } }], "message");
    expect(seen.said).toEqual(["Hello there"]);
  });

  it("the answer only in the task history, with a bare completed status", () => {
    const seen = shown([start, { task: { id: "t", contextId: "c", status: { state: "TASK_STATE_COMPLETED", timestamp: at() }, history: [user, agent("a", [text("Answer in history")])] } }]);
    expect(seen.said).toEqual(["Answer in history"]);
  });

  it("the answer as the completed status message, after working updates", () => {
    const seen = shown([start, status("WORKING", agent("w1", [text("Reading")])), status("WORKING", agent("w2", [text("Thinking")])), status("COMPLETED", agent("done", [text("All done")]))]);
    expect(seen.progress).toEqual(["Reading", "Thinking"]);
    expect(seen.said).toEqual(["All done"]);
  });

  it("the answer as an artifact, after a working update and a bare completed status", () => {
    const seen = shown([start, status("WORKING", agent("w", [text("Summarizing…")])), artifact("r", [text("The summary")], { lastChunk: true }), status("COMPLETED")]);
    expect(seen.said).toEqual([]);
    expect(seen.progress).toEqual(["Summarizing…"]);
    expect(seen.results).toEqual(["The summary"]);
  });

  it("the answer as a working status message when no result follows", () => {
    const seen = shown([start, status("WORKING", agent("w", [text("Here is everything you asked for")])), status("COMPLETED")]);
    expect(seen.said).toEqual(["Here is everything you asked for"]);
  });

  it("a question when input is required, with quick replies as data", () => {
    const seen = shown([start, status("WORKING", agent("w", [text("Checking")])), status("INPUT_REQUIRED", agent("q", [text("Which one?"), { data: { options: ["a", "b"] } }]))]);
    expect(seen.said).toEqual(['Which one? {"options":["a","b"]}']);
    expect(seen.view.messages.at(-1)).toMatchObject({ fromStatus: true, statusState: "TASK_STATE_INPUT_REQUIRED" });
  });

  it("an authorization request, a failure and a rejection, each with a message", () => {
    for (const state of ["AUTH_REQUIRED", "FAILED", "REJECTED"]) {
      expect(shown([start, status(state, agent(`m-${state}`, [text(`${state} because`)]))]).said).toEqual([`${state} because`]);
    }
  });

  it("a cancel with no message shows nothing new", () => {
    const seen = shown([start, status("WORKING", agent("w", [text("Working on it")])), status("CANCELED")]);
    expect(seen.said).toEqual(["Working on it"]);
  });

  it("standalone agent messages inside a task stream", () => {
    const seen = shown([start, { message: { ...agent("s1", [text("First note")]), taskId: "t", contextId: "c" } }, { message: { ...agent("s2", [text("Final words")]), taskId: "t", contextId: "c" } }, status("COMPLETED")]);
    expect(seen.progress).toEqual(["First note"]);
    expect(seen.said).toEqual(["Final words"]);
  });

  it("tool calls in status updates go to progress and keep the sub-agent named on the event", () => {
    const call = agent("call", [{ data: { id: "c1", name: "search", args: { q: "x" } }, metadata: { adk_type: "function_call" } }]);
    const seen = shown([start, status("WORKING", call, { adk_author: "researcher" }), status("COMPLETED", agent("done", [text("Found it")]))]);
    expect(seen.progress).toHaveLength(1);
    expect(seen.said).toEqual(["Found it"]);
    expect(seen.view.messages.find((message) => message.id === "call")?.metadata).toMatchObject({ adk_author: "researcher" });
  });

  it("a tool call as a standalone message goes to activity", () => {
    const seen = shown([start, { message: { ...agent("tool", [{ data: { id: "c1", name: "search", response: { hits: 3 } } }]), taskId: "t" } }, status("COMPLETED", agent("done", [text("Done")]))]);
    expect(seen.activity).toHaveLength(1);
    expect(seen.said).toEqual(["Done"]);
  });

  it("a status message without an id that later shows up in history is shown once", () => {
    const question = agent(undefined, [text("Continue?")]);
    const seen = shown([start, status("INPUT_REQUIRED", question), { task: { id: "t", contextId: "c", status: { state: "TASK_STATE_INPUT_REQUIRED", timestamp: at() }, history: [user, question] } }]);
    expect(seen.said).toEqual(["Continue?"]);
  });

  it("artifact chunks append, and a re-sent artifact replaces the earlier one", () => {
    const streamed = shown([start, artifact("r", [text("Hel")]), artifact("r", [text("lo")], { append: true, lastChunk: true }), status("COMPLETED")]);
    expect(streamed.results).toEqual(["Hello"]);
    const replaced = shown([start, artifact("r", [text("Draft")], { lastChunk: true }), artifact("r", [text("Final")], { lastChunk: true }), status("COMPLETED")]);
    expect(replaced.results).toEqual(["Final"]);
  });

  it("an artifact that never says lastChunk is settled when the task ends, and de-duplicates a repeated final message", () => {
    const seen = shown([start, artifact("r", [text("The same answer, long enough to compare safely.")]), status("COMPLETED", agent("done", [text("The same answer, long enough to compare safely.")]))]);
    expect(seen.results).toHaveLength(1);
    expect(seen.said).toEqual([]);
  });

  it("several artifacts with mixed parts all become results", () => {
    const seen = shown([start, artifact("a", [text("Summary")], { lastChunk: true }), artifact("b", [{ data: [{ id: 1 }] }, text("note")], { lastChunk: true }), status("COMPLETED")]);
    expect(seen.results).toHaveLength(2);
  });
});
