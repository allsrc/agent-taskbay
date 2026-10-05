import { describe, expect, it } from "vitest";
import type { DurableTaskView, ThreadMessage } from "@/shared/task-types";
import { STRUCTURED_FORM_EXTENSION_URI, STRUCTURED_FORM_MEDIA_TYPE } from "@/lib/structured-form";
import { RunInputError, answerParts, interruptIdFor, planRun } from "./run-input";
import { RunTranslator, type AgUiEvent } from "./translator";

const TASK = "11111111-1111-4111-8111-111111111111";
const input = (extra: Record<string, unknown> = {}) => ({ threadId: "thread-1", runId: "run-1", messages: [{ id: "u1", role: "user", content: "Deploy it" }], ...extra });

describe("AG-UI run input", () => {
  it("plans a send from the last user message and ignores fields it does not act on", () => {
    expect(planRun(input({ state: { a: 1 }, tools: [{ name: "x" }], context: [], forwardedProps: { z: 1 }, protocolVersion: "1.0" })))
      .toEqual({ kind: "send", threadId: "thread-1", runId: "run-1", messageId: "u1", text: "Deploy it" });
    expect(planRun(input({ messages: [{ id: "u2", role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }] }))).toMatchObject({ text: "a\nb" });
  });
  it("plans a resume from exactly one entry naming a task interrupt", () => {
    const plan = planRun(input({ resume: [{ interruptId: interruptIdFor(TASK), status: "answered", payload: { a: 1 } }] }));
    expect(plan).toEqual({ kind: "resume", threadId: "thread-1", runId: "run-1", localTaskId: TASK, status: "answered", payload: { a: 1 } });
  });
  it("rejects malformed, unsupported and ambiguous input", () => {
    const bad = (value: unknown) => expect(() => planRun(value)).toThrow(RunInputError);
    bad(null); bad({}); bad(input({ threadId: "bad id!" })); bad(input({ runId: "" })); bad(input({ messages: [] }));
    bad(input({ messages: [{ id: "a", role: "assistant", content: "hi" }] }));
    bad(input({ messages: [{ id: "a", role: "user", content: [{ type: "image", source: {} }] }] }));
    bad(input({ messages: [{ id: "a", role: "user", content: "   " }] }));
    bad(input({ resume: [{ interruptId: "task:not-a-uuid", status: "answered", payload: "x" }] }));
    bad(input({ resume: [{ interruptId: interruptIdFor(TASK), status: "answered", payload: "x" }, { interruptId: interruptIdFor(TASK), status: "abandoned" }] }));
    bad(input({ resume: [{ interruptId: interruptIdFor(TASK), status: "maybe" }] }));
  });
  it("turns an answer payload into a text or a single JSON data part", () => {
    expect(answerParts("yes")).toEqual([{ text: "yes", mediaType: "text/plain" }]);
    expect(answerParts({ replicas: 3 })).toEqual([{ data: { replicas: 3 }, mediaType: "application/json" }]);
    expect(() => answerParts("  ")).toThrow(RunInputError);
    expect(() => answerParts(undefined)).toThrow(RunInputError);
  });
});

const agent = (id: string, parts: ThreadMessage["parts"], fromStatus = false): ThreadMessage => ({ id, role: "agent", parts, timestamp: "2026-10-05T00:00:00Z", fromStatus });
const textPart = (value: string) => ({ id: "t", kind: "text" as const, value, mediaType: "text/plain" });
const view = (state: string, messages: ThreadMessage[], artifacts: DurableTaskView["artifacts"] = []): DurableTaskView =>
  ({ localId: TASK, taskId: "remote-1", contextId: "thread-1", tenant: "", agentId: "a", agentName: "A", state, createdAt: "", updatedAt: "", messages, artifacts, referenceLinks: {} });
const formValue = { title: "Deploy", schema: { type: "object", required: ["env"], properties: { env: { type: "string", enum: ["staging", "prod"] } } } };
const formPart = { id: "f", kind: "data" as const, value: formValue, mediaType: STRUCTURED_FORM_MEDIA_TYPE };
const types = (events: AgUiEvent[]) => events.map((event) => event.type);
const make = (baseline: string[] = [], advertisedExtensions: string[] = []) => new RunTranslator({ threadId: "thread-1", runId: "run-1" }, baseline, { advertisedExtensions, now: () => 1 });

describe("AG-UI run translation", () => {
  it("emits a well-formed run: start, state, a message once, and one terminal event", () => {
    const run = make();
    expect(run.start()).toEqual([{ type: "RUN_STARTED", threadId: "thread-1", runId: "run-1", timestamp: 1 }]);
    const working = view("TASK_STATE_WORKING", [agent("m1", [textPart("Working on it")])]);
    expect(types(run.observe(working))).toEqual(["STATE_SNAPSHOT", "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"]);
    expect(run.observe(working)).toEqual([]);
    const done = view("TASK_STATE_COMPLETED", working.messages);
    expect(types(run.observe(done))).toEqual(["STATE_SNAPSHOT"]);
    expect(run.finish(done)).toEqual([{ type: "RUN_FINISHED", threadId: "thread-1", runId: "run-1", outcome: { type: "success" }, timestamp: 1 }]);
    expect(run.finish(done)).toEqual([]);
    expect(run.error("late", "x")).toEqual([]);
    expect(run.observe(done)).toEqual([]);
  });
  it("never replays messages that were on the task before a resume", () => {
    const run = make(["old"]);
    expect(types(run.observe(view("TASK_STATE_WORKING", [agent("old", [textPart("earlier")])])))).toEqual(["STATE_SNAPSHOT"]);
    expect(run.agentMessagesSeen).toBe(1);
  });
  it("ends an input request with an interrupt carrying the form schema only when the extension is advertised", () => {
    const asking = view("TASK_STATE_INPUT_REQUIRED", [agent("q", [textPart("Where?"), formPart], true)]);
    const advertised = make([], [STRUCTURED_FORM_EXTENSION_URI]).finish(asking)[0] as AgUiEvent & { outcome: { interrupts: Array<Record<string, unknown>> } };
    expect(advertised.type).toBe("RUN_FINISHED");
    expect(advertised.outcome.interrupts).toHaveLength(1);
    expect(advertised.outcome.interrupts[0]).toMatchObject({ id: interruptIdFor(TASK), reason: "input_required", message: "Where?", responseSchema: formValue.schema });
    const plain = make().finish(asking)[0] as typeof advertised;
    expect(plain.outcome.interrupts[0].responseSchema).toBeUndefined();
    const invalid = make([], [STRUCTURED_FORM_EXTENSION_URI]).finish(view("TASK_STATE_INPUT_REQUIRED", [agent("q", [textPart("?"), { ...formPart, value: { schema: { type: "object", properties: { n: { type: "object" } } } } }], true)]))[0] as typeof advertised;
    expect(invalid.outcome.interrupts[0].responseSchema).toBeUndefined();
    const auth = make().finish(view("TASK_STATE_AUTH_REQUIRED", []))[0] as typeof advertised;
    expect(auth.outcome.interrupts[0]).toMatchObject({ reason: "auth_required", message: "The agent needs authorization." });
  });
  it("maps cancelled, failed and message-only tasks and never reports an unsettled task as success", () => {
    expect(make().finish(view("TASK_STATE_CANCELED", []))[0]).toMatchObject({ type: "RUN_FINISHED", outcome: { type: "cancelled" } });
    expect(make().finish(view("MESSAGE_ONLY", []))[0]).toMatchObject({ type: "RUN_FINISHED", outcome: { type: "success" } });
    expect(make().finish(view("TASK_STATE_FAILED", [agent("f", [textPart("Disk full")])]))[0]).toMatchObject({ type: "RUN_ERROR", message: "Disk full", code: "FAILED" });
    expect(make().finish(view("TASK_STATE_REJECTED", []))[0]).toMatchObject({ type: "RUN_ERROR", message: "The task rejected." });
    expect(make().finish(view("TASK_STATE_WORKING", []))[0]).toMatchObject({ type: "RUN_ERROR", code: "unsettled" });
  });
  it("surfaces non-text parts and completed artifacts as custom events, truncating oversized data", () => {
    const run = make();
    const big = { id: "d", kind: "data" as const, value: { blob: "x".repeat(70_000) }, mediaType: "application/json" };
    const events = run.observe(view("TASK_STATE_WORKING", [agent("m", [formPart, big])], [
      { artifactId: "art", name: "Report", complete: true, updateCount: 2, parts: [{ id: "p", kind: "raw", value: "/api/artifacts/x", mediaType: "text/plain", filename: "r.txt" }] },
      { artifactId: "partial", complete: false, updateCount: 1, parts: [] }]));
    const customs = events.filter((event) => event.type === "CUSTOM");
    expect(customs.map((event) => event.name)).toEqual(["a2a.part", "a2a.part", "a2a.artifact"]);
    expect(customs[1].value).toMatchObject({ truncated: true });
    expect(customs[1].value).not.toHaveProperty("value");
    expect(customs[2].value).toMatchObject({ artifactId: "art", parts: [{ filename: "r.txt", value: "/api/artifacts/x" }] });
  });
});
