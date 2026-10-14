import { describe, expect, it } from "vitest";
import { isActivityArtifact, isActivityMessage, isReasoningPart, planMessages, repeatsArtifact, settleArtifacts, statusAuthor, toolPartLabel } from "@/lib/chat-activity";
import type { ThreadMessage } from "@/store/task-store";
import type { AssembledArtifact } from "@/lib/types";

const artifact = (parts: AssembledArtifact["parts"], extra: Partial<AssembledArtifact> = {}): AssembledArtifact => ({ artifactId: "a", parts, complete: true, updateCount: 1, ...extra });
const json = (value: unknown, mediaType = "application/json") => ({ id: "p", kind: "data" as const, value, mediaType });
const text = (value: string) => ({ id: "t", kind: "text" as const, value, mediaType: "text/plain" });

describe("activity artifacts", () => {
  it("keeps generic JSON artifacts visible and recognizes tool-shaped JSON", () => {
    expect(isActivityArtifact(artifact([json({ rows: [{ id: 1, name: "example" }] })]))).toBe(false);
    expect(isActivityArtifact(artifact([json({ tool: "search", args: { q: "x" } })]))).toBe(true);
    expect(isActivityArtifact(artifact([json({ id: "call-1", name: "list_directory", args: { path: "/kb" } })]))).toBe(true);
    expect(isActivityArtifact(artifact([json({ id: "call-1", name: "list_directory", response: { content: [] }, isError: false })]))).toBe(true);
    expect(isActivityArtifact(artifact([text("The answer is 42")]))).toBe(false);
    expect(isActivityArtifact(artifact([text("a"), json({})]))).toBe(false);
  });

  it("keeps Taskbay's own media types as ordinary artifacts", () => {
    expect(isActivityArtifact(artifact([json({ title: "Deploy" }, "application/vnd.agent-taskbay.form+json")]))).toBe(false);
  });

  it("recognizes framework-tagged tool traffic, even beside other parts, and labels call versus result", () => {
    const call = { id: "c", kind: "data" as const, value: { name: "get_weather", args: { city: "Oslo" } }, mediaType: "application/json", metadata: { type: "function_call" } };
    const response = { ...call, value: { name: "get_weather", response: { temp: 4 } }, metadata: { adk_type: "function_response" } };
    expect(isActivityArtifact(artifact([call]))).toBe(true);
    expect(toolPartLabel(call)).toBe("get_weather · call");
    expect(toolPartLabel(response)).toBe("get_weather · result");
  });

  it("labels a tool step by the tool name its payload carries", () => {
    expect(toolPartLabel(json({ tool: "get_weather" }))).toBe("get_weather");
    expect(toolPartLabel(json({ function: { name: "lookup" } }))).toBe("lookup");
    expect(toolPartLabel(json({ rows: 3 }))).toBe("Tool activity");
  });
});

describe("activity messages", () => {
  it("recognizes tool-shaped JSON messages without classifying generic JSON replies", () => {
    const call = { parts: [json({ id: "call-1", name: "list_directory", args: { path: "/kb" } })] };
    const result = { parts: [json({ id: "call-1", name: "list_directory", response: { content: [] } })] };
    expect(isActivityMessage(call)).toBe(true);
    expect(toolPartLabel(call.parts[0])).toBe("list_directory");
    expect(isActivityMessage(result)).toBe(true);
    expect(isActivityMessage({ parts: [json({ rows: [{ id: 1 }] })] })).toBe(false);
    expect(isActivityMessage({ parts: [text("The answer is 42")] })).toBe(false);
  });
});

describe("duplicate final answers", () => {
  const message = (value: string) => ({ parts: [text(value)] });
  const answer = "Deployment finished: 3 replicas are healthy in staging and the smoke tests passed.";

  it("drops a message that only repeats a finished text artifact", () => {
    expect(repeatsArtifact(message(answer), [artifact([text(answer)])])).toBe(true);
    expect(repeatsArtifact(message(`  ${answer.toUpperCase()}\n`), [artifact([text(answer)])])).toBe(true);
    expect(repeatsArtifact(message("Here is the result.\n" + answer), [artifact([text(answer)])])).toBe(true);
  });

  it("keeps distinct messages, unfinished artifacts and activity", () => {
    expect(repeatsArtifact(message("Working on it"), [artifact([text(answer)])])).toBe(false);
    expect(repeatsArtifact(message(answer), [artifact([text(answer)], { complete: false })])).toBe(false);
    expect(repeatsArtifact(message("Hi"), [artifact([text("Hi")])])).toBe(true);
    expect(repeatsArtifact(message(answer), [artifact([json({ tool: "x" })])])).toBe(false);
  });
});

describe("reasoning parts", () => {
  const thought = (value: string, meta: Record<string, unknown> = { thought: true }) => ({ id: "r", kind: "text" as const, value, mediaType: "text/plain", metadata: meta });

  it("recognizes reasoning marked by common frameworks", () => {
    expect(isReasoningPart(thought("hmm"))).toBe(true);
    expect(isReasoningPart(thought("hmm", { adk_thought: true }))).toBe(true);
    expect(isReasoningPart(thought("hmm", { type: "reasoning" }))).toBe(true);
    expect(isReasoningPart(text("Plain answer"))).toBe(false);
  });

  it("folds a reasoning-only artifact into activity", () => {
    expect(isActivityArtifact(artifact([thought("Let me think")]))).toBe(true);
  });

  it("does not count reasoning as the answer when looking for duplicates", () => {
    const answer = "Everything is healthy and all twelve smoke tests passed in staging.";
    const message = { parts: [thought("I should check the tests"), text(answer)] };
    expect(repeatsArtifact(message, [artifact([text(answer)])])).toBe(true);
  });
});

describe("settling streamed artifacts", () => {
  it("marks unfinished artifacts complete once the task is over, and leaves running tasks alone", () => {
    const open = artifact([text("partial")], { complete: false });
    expect(settleArtifacts([open], true)[0].complete).toBe(true);
    expect(settleArtifacts([open], false)[0].complete).toBe(false);
  });

  it("lets a finished task's un-terminated answer de-duplicate the final message", () => {
    const answer = "Staging is healthy and the smoke tests passed, so no rollback is needed.";
    const open = artifact([text(answer)], { complete: false });
    expect(repeatsArtifact({ parts: [text(answer)] }, [open])).toBe(false);
    expect(repeatsArtifact({ parts: [text(answer)] }, settleArtifacts([open], true))).toBe(true);
  });
});

describe("where task messages go", () => {
  const say = (id: string, value: string, extra: Partial<ThreadMessage> = {}) => ({ id, role: "agent", parts: [text(value)], ...extra }) as ThreadMessage;
  const you = { id: "u", role: "user", parts: [text("Deploy it")] } as ThreadMessage;
  const call = say("call", "", { fromStatus: true, parts: [json({ id: "c1", name: "list_directory", args: {} }, "application/json")] });
  const plan = (state: string, messages: ThreadMessage[]) => planMessages({ kind: "task", state, messages }, []);

  it("folds status updates into progress while the agent works", () => {
    const { isUpdate } = plan("TASK_STATE_WORKING", [you, say("a", "Reading", { fromStatus: true }), say("b", "Summarizing", { fromStatus: true })]);
    expect([isUpdate(1), isUpdate(2)]).toEqual([true, true]);
  });

  it("keeps the question in the conversation when the agent needs input", () => {
    const { isUpdate } = plan("TASK_STATE_INPUT_REQUIRED", [you, say("a", "Looking", { fromStatus: true }), say("q", "Which environment?", { fromStatus: true })]);
    expect(isUpdate(1)).toBe(true);
    expect(isUpdate(2)).toBe(false);
  });

  it("keeps the final status message as the reply once the task ends", () => {
    const { isUpdate } = plan("TASK_STATE_COMPLETED", [you, say("a", "Working", { fromStatus: true }), say("done", "Found 3 services.", { fromStatus: true })]);
    expect(isUpdate(2)).toBe(false);
  });

  it("never treats a tool call as the reply", () => {
    expect(plan("TASK_STATE_COMPLETED", [you, call]).isUpdate(1)).toBe(true);
  });

  it("sends tool-only agent messages outside status updates to the activity log", () => {
    const standalone = { ...call, id: "tool", fromStatus: false };
    const { activityMessages, isUpdate } = plan("TASK_STATE_WORKING", [you, standalone, say("b", "Done")]);
    expect(activityMessages.map((message) => message.id)).toEqual(["tool"]);
    expect(isUpdate(1)).toBe(false);
  });

  it("drops a final message that repeats a finished result", () => {
    const answer = "Deployment finished: 3 replicas are healthy in staging and the smoke tests passed.";
    const { repeated } = planMessages({ kind: "task", state: "TASK_STATE_COMPLETED", messages: [you, say("done", answer, { fromStatus: true })] }, [artifact([text(answer)])]);
    expect(repeated).toBe(true);
  });

  it("does not fold a direct message reply", () => {
    expect(planMessages({ kind: "message", state: "", messages: [you, say("r", "Hi")] }, []).isUpdate(1)).toBe(false);
  });
});

describe("step labels", () => {
  it("names a tool part and only names a status author who is not the agent", () => {
    expect(toolPartLabel({ ...json({ id: "c", name: "search", args: {} }), metadata: { adk_type: "function_call" } })).toBe("search · call");
    expect(statusAuthor({ metadata: { adk_author: "knowledge_agent" } }, "Knowledge agent")).toBe("knowledge_agent");
    expect(statusAuthor({ metadata: { adk_author: "Knowledge agent" } }, "Knowledge agent")).toBeNull();
    expect(statusAuthor({}, "Knowledge agent")).toBeNull();
  });
});
