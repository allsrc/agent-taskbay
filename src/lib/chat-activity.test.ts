import { describe, expect, it } from "vitest";
import { activityLabel, isActivityArtifact, isReasoningOnly, isReasoningPart, repeatsArtifact, settleArtifacts } from "@/lib/chat-activity";
import type { AssembledArtifact } from "@/lib/types";

const artifact = (parts: AssembledArtifact["parts"], extra: Partial<AssembledArtifact> = {}): AssembledArtifact => ({ artifactId: "a", parts, complete: true, updateCount: 1, ...extra });
const json = (value: unknown, mediaType = "application/json") => ({ id: "p", kind: "data" as const, value, mediaType });
const text = (value: string) => ({ id: "t", kind: "text" as const, value, mediaType: "text/plain" });

describe("activity artifacts", () => {
  it("treats JSON-only artifacts as activity and text as an answer", () => {
    expect(isActivityArtifact(artifact([json({ tool: "search", args: { q: "x" } })]))).toBe(true);
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
    expect(activityLabel(artifact([call]))).toBe("get_weather · call");
    expect(activityLabel(artifact([response]))).toBe("get_weather · result");
  });

  it("labels an activity by its tool name, then its artifact name", () => {
    expect(activityLabel(artifact([json({ tool: "get_weather" })]))).toBe("get_weather");
    expect(activityLabel(artifact([json({ function: { name: "lookup" } })]))).toBe("lookup");
    expect(activityLabel(artifact([json({ rows: 3 })], { name: "Query result" }))).toBe("Query result");
    expect(activityLabel(artifact([json({ rows: 3 })]))).toBe("Tool result");
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

  it("folds a reasoning-only artifact into activity and labels it", () => {
    expect(isActivityArtifact(artifact([thought("Let me think")]))).toBe(true);
    expect(activityLabel(artifact([thought("Let me think")]))).toBe("Reasoning");
  });

  it("does not count reasoning as the answer when looking for duplicates", () => {
    const answer = "Everything is healthy and all twelve smoke tests passed in staging.";
    const message = { parts: [thought("I should check the tests"), text(answer)] };
    expect(isReasoningOnly(message)).toBe(false);
    expect(isReasoningOnly({ parts: [thought("only thinking")] })).toBe(true);
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
