import { describe, expect, it } from "vitest";
import { assembleArtifacts, assembleTasks, normalizePart, parseCsv } from "./content";

describe("content normalization", () => {
  it("normalizes v1 and v0.3 parts", () => {
    expect(normalizePart({ text: "hello", mediaType: "text/plain" })).toMatchObject({ kind: "text", value: "hello" });
    expect(normalizePart({ data: [{ city: "Kyoto" }], mediaType: "application/json" })).toMatchObject({ kind: "data", mediaType: "application/json" });
    expect(normalizePart({ raw: "iVBORw0KGgo=", filename: "map.png", mediaType: "image/png" })).toMatchObject({ kind: "raw", filename: "map.png", mediaType: "image/png" });
    expect(normalizePart({ url: "https://example.com/report.pdf", filename: "report.pdf", mediaType: "application/pdf" })).toMatchObject({ kind: "url", filename: "report.pdf", mediaType: "application/pdf" });
  });

  it("assembles append-only artifact stream chunks", () => {
    const artifacts = assembleArtifacts([
      { artifactUpdate: { artifact: { artifactId: "a", name: "Answer", parts: [{ text: "first" }] }, append: false, lastChunk: false } },
      { artifactUpdate: { artifact: { artifactId: "a", parts: [{ text: "second" }] }, append: true, lastChunk: true } },
    ]);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].parts.map((part) => part.value)).toEqual(["firstsecond"]);
    expect(artifacts[0].complete).toBe(true);
    expect(artifacts[0].updateCount).toBe(2);
  });

  it("tracks task status transitions from streamed updates", () => {
    const tasks = assembleTasks([
      { task: { id: "task-1", contextId: "ctx-1", status: { state: "TASK_STATE_WORKING" } } },
      { statusUpdate: { taskId: "task-1", contextId: "ctx-1", status: { state: "TASK_STATE_INPUT_REQUIRED" } } },
    ]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toMatchObject({ state: "TASK_STATE_INPUT_REQUIRED" });
  });

  it("parses CSV with quoted fields", () => {
    expect(parseCsv('a,"b,c"\n1,2')).toEqual([["a", "b,c"], ["1", "2"]]);
  });
});
