import { isA2uiPart } from "@/lib/a2ui";
import type { AssembledArtifact, NormalizedPart } from "@/lib/types";
import type { ThreadMessage } from "@/store/task-store";

const isJsonPart = (part: NormalizedPart) => part.kind === "data" || /json/i.test(part.mediaType);

const REASONING_TYPES = new Set(["thought", "thinking", "reasoning"]);

/** A text part the agent marked as its reasoning (Google ADK sets `thought`; others use a `type` of thought / reasoning). */
export function isReasoningPart(part: NormalizedPart): boolean {
  if (part.kind !== "text") return false;
  const meta = part.metadata;
  if (!meta) return false;
  if (meta.thought === true || meta.adk_thought === true || meta.reasoning === true) return true;
  return ["adk_type", "type", "kind"].some((key) => typeof meta[key] === "string" && REASONING_TYPES.has(meta[key] as string));
}

/** True when every part of a message is reasoning, so there is nothing to show as a reply. */
export const isReasoningOnly = (message: Pick<ThreadMessage, "parts">) => message.parts.length > 0 && message.parts.every(isReasoningPart);

/** Agent frameworks tag tool traffic on the part: Google ADK uses `type` (or `adk_type`) of function_call / function_response. */
const TOOL_TYPES = new Set(["function_call", "function_response", "tool_call", "tool_result", "tool_use", "code_execution_result", "executable_code"]);
const toolType = (part: NormalizedPart): string | undefined => {
  for (const key of ["adk_type", "type", "kind"]) {
    const value = part.metadata?.[key];
    if (typeof value === "string" && TOOL_TYPES.has(value)) return value;
  }
  return undefined;
};

/**
 * An artifact that is only structured data, such as a tool call or its result. It is background activity, not an
 * answer: it folds into the activity log instead of getting a card. Forms, approval requests and A2UI surfaces are
 * Taskbay's own media types and stay as they are.
 */
export function isActivityArtifact(artifact: AssembledArtifact): boolean {
  return (
    artifact.parts.length > 0 &&
    artifact.parts.every((part) => (isJsonPart(part) && !part.mediaType.startsWith("application/vnd.agent-taskbay") && !isA2uiPart(part)) || toolType(part) !== undefined || isReasoningPart(part))
  );
}

const SUFFIX: Record<string, string> = { function_call: "call", tool_call: "call", tool_use: "call", executable_code: "code", function_response: "result", tool_result: "result", code_execution_result: "result" };

/** A short label for an activity artifact: the tool or function name when the JSON carries one, else the artifact name. */
export function activityLabel(artifact: AssembledArtifact): string {
  if (artifact.parts.length > 0 && artifact.parts.every(isReasoningPart)) return "Reasoning";
  for (const part of artifact.parts) {
    const kind = toolType(part);
    const suffix = kind ? ` · ${SUFFIX[kind]}` : "";
    const value = part.value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      for (const key of ["tool", "toolName", "tool_name", "name", "function", "action", "type"]) {
        const candidate = record[key];
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim() + suffix;
        if (candidate && typeof candidate === "object" && typeof (candidate as { name?: unknown }).name === "string") return (candidate as { name: string }).name + suffix;
      }
    }
  }
  return artifact.name?.trim() || "Tool result";
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

export const messageText = (message: Pick<ThreadMessage, "parts">) =>
  message.parts.filter((part) => part.kind === "text" && !isReasoningPart(part)).map((part) => String(part.value)).join("\n");

export const artifactText = (artifact: AssembledArtifact) =>
  artifact.parts.filter((part) => part.kind === "text" && !isReasoningPart(part)).map((part) => String(part.value)).join("");

/**
 * True when the agent's last message only repeats a finished text artifact (the same answer sent twice, once as a
 * message and once as the result). The artifact is kept and the message is dropped.
 */
export function repeatsArtifact(message: Pick<ThreadMessage, "parts">, artifacts: AssembledArtifact[]): boolean {
  const said = squash(messageText(message));
  if (!said) return false;
  return artifacts.some((artifact) => {
    if (!artifact.complete || isActivityArtifact(artifact)) return false;
    const result = squash(artifactText(artifact));
    if (!result) return false;
    return said === result || (said.length >= 40 && (result.includes(said) || said.includes(result)));
  });
}

/**
 * Once a task has finished no more chunks can arrive, so a streamed artifact that never got `lastChunk` is complete.
 * Without this an agent that omits `lastChunk` would keep its answer looking unfinished (and never de-duplicated).
 */
export const settleArtifacts = (artifacts: AssembledArtifact[], taskFinished: boolean): AssembledArtifact[] =>
  taskFinished ? artifacts.map((artifact) => (artifact.complete ? artifact : { ...artifact, complete: true })) : artifacts;
