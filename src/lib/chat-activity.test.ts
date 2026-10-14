import { describe, expect, it } from "vitest";
import { activityLabel, isActivityArtifact, repeatsArtifact } from "@/lib/chat-activity";
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
