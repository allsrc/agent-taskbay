import { describe, expect, it } from "vitest";
import { isActivityArtifact } from "@/lib/chat-activity";
import { callNames, describeData } from "@/lib/data-part";
import type { AssembledArtifact } from "@/lib/types";

const data = (value: unknown, metadata?: Record<string, unknown>) => ({ id: "p", kind: "data" as const, value, mediaType: "application/json", metadata });
const artifact = (part: ReturnType<typeof data>): AssembledArtifact => ({ artifactId: "a", parts: [part], complete: true, updateCount: 1 });

describe("summaries of data parts from agent frameworks", () => {
  it("Google ADK function calls, responses, tool calls and code, tagged with adk_type", () => {
    expect(describeData(data({ id: "adk-1", name: "list_directory", args: { path: "/kb" } }, { adk_type: "function_call" })))
      .toEqual({ kind: "tool-call", title: "list_directory", id: "adk-1", preview: 'path: "/kb"' });
    expect(describeData(data({ id: "adk-1", name: "list_directory", response: { files: ["a.md"] } }, { adk_type: "function_response" })))
      .toMatchObject({ kind: "tool-result", title: "list_directory", id: "adk-1", preview: "files: [1]" });
    expect(describeData(data({ id: "t1", name: "search", response: {} }, { adk_type: "tool_response" })).kind).toBe("tool-result");
    expect(describeData(data({ code: "print(1)", language: "PYTHON" }, { adk_type: "executable_code" }))).toMatchObject({ kind: "code", title: "Code · python" });
    expect(describeData(data({ outcome: "OUTCOME_FAILED", output: "Traceback" }, { adk_type: "code_execution_result" }))).toMatchObject({ kind: "code-result", failed: true });
  });

  it("OpenAI function calls, tool call lists and tool messages", () => {
    expect(describeData(data({ id: "call_abc", type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } })))
      .toMatchObject({ kind: "tool-call", title: "get_weather", id: "call_abc", preview: 'city: "Paris"' });
    expect(describeData(data({ tool_calls: [{ function: { name: "a" } }, { function: { name: "b" } }] }))).toMatchObject({ kind: "tool-call", title: "a, b" });
    expect(describeData(data({ role: "tool", tool_call_id: "call_abc", content: "18°C" }))).toMatchObject({ kind: "tool-result", id: "call_abc" });
  });

  it("Anthropic tool_use, tool_result and thinking blocks", () => {
    expect(describeData(data({ type: "tool_use", id: "toolu_01", name: "search", input: { q: "a2a" } }))).toMatchObject({ kind: "tool-call", title: "search", id: "toolu_01" });
    expect(describeData(data({ type: "tool_result", tool_use_id: "toolu_01", content: "No results", is_error: true }))).toMatchObject({ kind: "tool-result", id: "toolu_01", failed: true, preview: '"No results"' });
    expect(describeData(data({ type: "thinking", thinking: "First, list the files." }))).toEqual({ kind: "reasoning", title: "Reasoning", text: "First, list the files." });
  });

  it("Vercel AI SDK tool-call, tool-result, typed tool parts and reasoning", () => {
    expect(describeData(data({ type: "tool-call", toolCallId: "v1", toolName: "lookup", input: { id: 7 } }))).toMatchObject({ kind: "tool-call", title: "lookup", id: "v1" });
    expect(describeData(data({ type: "tool-result", toolCallId: "v1", toolName: "lookup", output: { ok: true } }))).toMatchObject({ kind: "tool-result", title: "lookup" });
    expect(describeData(data({ type: "tool-getWeather", toolCallId: "v2", state: "output-available", input: {}, output: { temp: 18 } }))).toMatchObject({ kind: "tool-result", title: "getWeather" });
    expect(describeData(data({ type: "reasoning", text: "Thinking it through" })).kind).toBe("reasoning");
  });

  it("MCP tools/call requests and results", () => {
    expect(describeData(data({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "read_file", arguments: { path: "a" } } })))
      .toMatchObject({ kind: "tool-call", title: "read_file", id: "4" });
    expect(describeData(data({ content: [{ type: "text", text: "hi" }], isError: false }))).toMatchObject({ kind: "tool-result", failed: false });
  });

  it("LangChain / LangGraph tool calls and tool messages", () => {
    expect(describeData(data({ type: "ai", content: "", tool_calls: [{ name: "search", args: { q: "x" }, id: "lc1", type: "tool_call" }] }))).toMatchObject({ kind: "tool-call", title: "search" });
    expect(describeData(data({ name: "search", args: { q: "x" }, id: "lc1", type: "tool_call" }))).toMatchObject({ kind: "tool-call", title: "search", id: "lc1" });
    expect(describeData(data({ type: "tool", tool_call_id: "lc1", name: "search", content: "3 hits", status: "success" }))).toMatchObject({ kind: "tool-result", title: "search", id: "lc1", failed: false });
    expect(describeData(data({ type: "tool", tool_call_id: "lc2", content: "boom", status: "error" })).failed).toBe(true);
  });

  it("an untagged call id with JSON below it", () => {
    expect(describeData(data({ call_id: "callid_4456", output: { rows: 3 } }))).toMatchObject({ kind: "tool-result", id: "callid_4456" });
  });

  it("names a result after its call when it only carries the call id", () => {
    const parts = [data({ type: "tool_use", id: "toolu_9", name: "fetch_page", input: {} }), data({ type: "tool_result", tool_use_id: "toolu_9", content: "ok" })];
    expect(describeData(parts[1], callNames(parts)).title).toBe("fetch_page");
  });

  it("summarizes any other JSON by title, id and first fields, and lists and tables by size", () => {
    expect(describeData(data({ id: "evt_42", status: "queued", position: 3, eta: "2m", region: "eu" })))
      .toEqual({ kind: "data", title: "queued", id: "evt_42", preview: 'position: 3, eta: "2m", region: "eu"' });
    expect(describeData(data({ a: 1, b: 2, c: 3, d: 4 })).preview).toBe("a: 1, b: 2, c: 3 · +1 more");
    expect(describeData(data([{ id: 1, name: "x" }, { id: 2 }]))).toMatchObject({ title: "Table", preview: "2 rows × 2 columns" });
    expect(describeData(data([1, 2, 3]))).toMatchObject({ title: "List", preview: "3 items" });
    expect(describeData(data("just a string"))).toMatchObject({ title: "Value", preview: '"just a string"' });
  });

  it("marks errors", () => {
    expect(describeData(data({ error: { message: "Rate limited", code: 429 } }))).toMatchObject({ kind: "error", title: "Rate limited", failed: true });
  });

  it("does not fold ordinary data artifacts into the activity log", () => {
    for (const value of [{ id: 1, name: "report", content: "Quarterly numbers" }, { rows: [{ id: 1 }] }, { name: "build", status: "ok" }]) {
      expect(isActivityArtifact(artifact(data(value)))).toBe(false);
    }
    expect(isActivityArtifact(artifact(data({ type: "tool_use", id: "t", name: "x", input: {} })))).toBe(true);
    expect(isActivityArtifact(artifact(data({ type: "thinking", thinking: "hm" })))).toBe(true);
  });
});
