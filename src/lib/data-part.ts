import type { NormalizedPart } from "@/lib/types";

/**
 * A one-line summary of a structured part, for progress and activity logs. A2A data parts carry any JSON, so this
 * recognizes the shapes agent frameworks use for tool traffic and reasoning, and summarizes anything else by its title,
 * id and first fields. It never changes the part; the full JSON stays one click away.
 *
 * Recognized: Google ADK (`adk_type` metadata: function_call, function_response, tool_call, tool_response,
 * executable_code, code_execution_result), OpenAI (`function` calls, `role: "tool"` results, `tool_calls` lists),
 * Anthropic (`tool_use`, `tool_result`, `thinking`), Vercel AI SDK (`tool-call`, `tool-result`, `tool-<name>`,
 * `reasoning`), MCP (`tools/call`, `{ content, isError }` results) and plain `{ id, name, args | response }` envelopes.
 */
export type DataKind = "tool-call" | "tool-result" | "code" | "code-result" | "reasoning" | "error" | "data";

export interface DataSummary {
  kind: DataKind;
  /** Tool name or the best title the payload carries. */
  title: string;
  /** Call or request id, when the payload carries one. */
  id?: string;
  /** A short preview: call arguments, or the first scalar fields. */
  preview?: string;
  /** Reasoning text, shown as text instead of JSON. */
  text?: string;
  /** The payload reports a failure. */
  failed?: boolean;
}

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const idOf = (value: unknown) => (typeof value === "number" ? String(value) : str(value));
const first = <T>(...values: T[]) => values.find((value) => value !== undefined);

const TAGGED: Record<string, DataKind> = {
  function_call: "tool-call", tool_call: "tool-call", tool_use: "tool-call",
  function_response: "tool-result", tool_response: "tool-result", tool_result: "tool-result",
  executable_code: "code", code_execution_result: "code-result",
};
const REASONING_TYPES = new Set(["thought", "thinking", "reasoning", "redacted_thinking"]);

/** The framework tag on a part (`adk_type`, `type` or `kind` metadata), when it names tool traffic. */
export function taggedKind(part: Pick<NormalizedPart, "metadata">): DataKind | undefined {
  for (const key of ["adk_type", "type", "kind"]) {
    const value = part.metadata?.[key];
    if (typeof value === "string" && TAGGED[value]) return TAGGED[value];
  }
  return undefined;
}

function parse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return value;
  try { return JSON.parse(text); } catch { return value; }
}

function scalar(value: unknown, max = 32): string | undefined {
  if (typeof value === "string") return JSON.stringify(value.length > max ? `${value.slice(0, max - 1)}…` : value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  if (isRecord(value)) return `{${Object.keys(value).length}}`;
  return undefined;
}

/** `key: value` for the first few fields, then a count of the rest. */
function fields(value: unknown, skip: Set<string> = new Set(), limit = 3): string | undefined {
  value = parse(value);
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  if (!isRecord(value)) return scalar(value, 60);
  const entries = Object.entries(value).filter(([key, item]) => !skip.has(key) && item !== undefined);
  if (!entries.length) return undefined;
  const shown = entries.slice(0, limit).map(([key, item]) => `${key}: ${scalar(item)}`);
  return entries.length > limit ? `${shown.join(", ")} · +${entries.length - limit} more` : shown.join(", ");
}

const TITLE_KEYS = ["title", "name", "label", "event", "type", "kind", "status", "action", "step"];
const ID_KEYS = ["id", "callId", "call_id", "toolCallId", "tool_call_id", "tool_use_id", "requestId", "request_id", "runId", "run_id"];
const ARGS_KEYS = ["args", "arguments", "input", "parameters", "params"];
// `content` is too common to mark a result by itself; it counts only with an explicit result type (Anthropic, OpenAI, MCP).
const RESULT_KEYS = ["response", "result", "output"];

function errorText(record: Json): string | undefined {
  const error = record.error ?? record.errorText ?? record.error_message;
  if (typeof error === "string") return error;
  if (isRecord(error)) return str(error.message) ?? str(error.detail) ?? "Error";
  if (record.isError === true || record.is_error === true) return "Error";
  return undefined;
}

const resultTypeOf = (type: string | undefined) => type === "tool_result" || type === "tool-result" || type === "function_response" || type === "tool_response";

/** Recognizes tool traffic and reasoning by shape, from the frameworks listed above. */
function recognize(record: Json, tagged: DataKind | undefined): DataSummary | undefined {
  const type = str(record.type);
  const id = idOf(first(...ID_KEYS.map((key) => record[key])));
  const nameOf = (value: unknown) => str(value) ?? (isRecord(value) ? str(value.name) : undefined);
  // Reasoning: Anthropic `thinking`, Vercel `reasoning`, or a `thought` text field.
  const reasoning = str(record.thinking) ?? str(record.reasoning) ?? (typeof record.thought === "string" ? str(record.thought) : undefined)
    ?? (type && REASONING_TYPES.has(type) ? str(record.text) ?? "" : undefined);
  if (reasoning !== undefined && (type === undefined || REASONING_TYPES.has(type))) return { kind: "reasoning", title: "Reasoning", text: reasoning };
  // OpenAI: a list of tool calls.
  if (Array.isArray(record.tool_calls) && record.tool_calls.length) {
    const names = record.tool_calls.map((call) => (isRecord(call) ? nameOf(call.function) ?? nameOf(call.name) : undefined)).filter(Boolean);
    return { kind: "tool-call", title: names.length ? names.join(", ") : `${record.tool_calls.length} tool calls` };
  }
  // OpenAI tool result message.
  if (resultTypeOf(type) && record.content !== undefined && record.result === undefined && record.output === undefined && record.response === undefined) {
    const failure = errorText(record);
    return { kind: "tool-result", title: str(record.name) ?? str(record.toolName) ?? "Tool result", id, preview: (failure !== "Error" ? failure : undefined) ?? fields(record.content), failed: Boolean(failure) };
  }
  if (record.role === "tool") return { kind: "tool-result", title: str(record.name) ?? "Tool result", id, preview: fields(record.content), failed: Boolean(errorText(record)) };
  // MCP request.
  if (record.method === "tools/call" && isRecord(record.params)) return { kind: "tool-call", title: str(record.params.name) ?? "Tool call", id, preview: fields(record.params.arguments) };
  // Vercel `tool-<name>` part with a state.
  if (type?.startsWith("tool-") && !["tool-call", "tool-result"].includes(type)) {
    const output = record.output ?? record.result;
    return { kind: output !== undefined || record.errorText ? "tool-result" : "tool-call", title: type.slice(5), id, preview: fields(output ?? record.input), failed: Boolean(errorText(record)) };
  }
  // Code execution (ADK executable_code / code_execution_result).
  if (tagged === "code" || (typeof record.code === "string" && str(record.language))) {
    return { kind: "code", title: `Code${str(record.language) ? ` · ${String(record.language).toLowerCase()}` : ""}`, preview: scalar(record.code, 48) };
  }
  if (tagged === "code-result" || (str(record.outcome) && "output" in record)) {
    const outcome = str(record.outcome) ?? "";
    return { kind: "code-result", title: "Code output", preview: scalar(record.output, 48), failed: /fail|error|exceed/i.test(outcome) };
  }
  const name = first(nameOf(record.toolName), nameOf(record.tool_name), nameOf(record.tool), nameOf(record.function), str(record.name));
  const args = first(...ARGS_KEYS.map((key) => record[key]), isRecord(record.function) ? record.function.arguments : undefined);
  const result = first(...RESULT_KEYS.map((key) => record[key]));
  const callType = type === "tool_use" || type === "tool-call" || type === "function" || type === "function_call" || type === "tool_call";
  const resultType = resultTypeOf(type);
  const failure = errorText(record);
  // Explicit types, framework tags, or a `{ id, name, args | response }` envelope.
  if (callType || (tagged === "tool-call") || (!tagged && !resultType && name && args !== undefined && (id || str(record.tool)))) {
    return { kind: "tool-call", title: name ?? "Tool call", id, preview: fields(args) };
  }
  if (resultType || tagged === "tool-result" || (name && result !== undefined && (id || str(record.tool))) || (id && /tool|call/i.test(Object.keys(record).join(" ")) && result !== undefined)) {
    return { kind: "tool-result", title: name ?? "Tool result", id, preview: failure ?? fields(result), failed: Boolean(failure) || record.isError === true || record.is_error === true };
  }
  // MCP tool result: `{ content: [...], isError }`.
  if (Array.isArray(record.content) && typeof record.isError === "boolean") {
    return { kind: "tool-result", title: "Tool result", preview: fields(record.content), failed: record.isError };
  }
  return undefined;
}

/**
 * Summarizes a structured part. `names` maps call ids to tool names seen earlier, so a result that only carries the id
 * of its call is named after the call.
 */
export function describeData(part: Pick<NormalizedPart, "value" | "metadata" | "mediaType" | "filename">, names?: ReadonlyMap<string, string>): DataSummary {
  const value = parse(part.value);
  const tagged = taggedKind(part);
  if (isRecord(value)) {
    const known = recognize(value, tagged);
    if (known) {
      if (known.kind === "tool-result" && known.id && (known.title === "Tool result" || !known.title) && names?.has(known.id)) known.title = names.get(known.id)!;
      return known;
    }
    const failure = errorText(value);
    const titleKey = TITLE_KEYS.find((key) => str(value[key]) && String(value[key]).length <= 60);
    const id = idOf(first(...ID_KEYS.map((key) => value[key])));
    const skip = new Set([titleKey, ...ID_KEYS].filter((key): key is string => Boolean(key)));
    if (failure) return { kind: "error", title: failure.length > 80 ? `${failure.slice(0, 79)}…` : failure, id, failed: true, preview: fields(value, new Set([...skip, "error", "errorText", "error_message", "isError", "is_error"])) };
    return { kind: tagged ?? "data", title: titleKey ? String(value[titleKey]).trim() : part.filename ?? "Data", id, preview: fields(value, skip) };
  }
  if (Array.isArray(value)) {
    const rows = value.every(isRecord) && value.length > 0;
    const columns = rows ? new Set(value.flatMap((row) => Object.keys(row as Json))).size : 0;
    return { kind: tagged ?? "data", title: part.filename ?? (rows ? "Table" : "List"), preview: rows ? `${value.length} ${value.length === 1 ? "row" : "rows"} × ${columns} ${columns === 1 ? "column" : "columns"}` : `${value.length} ${value.length === 1 ? "item" : "items"}` };
  }
  return { kind: tagged ?? "data", title: part.filename ?? "Value", preview: scalar(value, 60) };
}

/** Tool names by call id, from the parts of a log, so results can be named after their calls. */
export function callNames(parts: Iterable<Pick<NormalizedPart, "value" | "metadata" | "mediaType" | "filename" | "kind">>): Map<string, string> {
  const names = new Map<string, string>();
  for (const part of parts) {
    if (part.kind !== "data" && !/json/i.test(part.mediaType)) continue;
    const summary = describeData(part);
    if (summary.kind === "tool-call" && summary.id && summary.title !== "Tool call") names.set(summary.id, summary.title);
  }
  return names;
}

/** True when the part is tool traffic or reasoning by tag or by shape: background work rather than an answer. */
export const isBackgroundData = (part: Pick<NormalizedPart, "value" | "metadata" | "mediaType" | "filename">) =>
  ["tool-call", "tool-result", "code", "code-result", "reasoning"].includes(describeData(part).kind);
