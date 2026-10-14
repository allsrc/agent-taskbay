import { isA2uiPart } from "@/lib/a2ui";
import type { AssembledArtifact, NormalizedPart } from "@/lib/types";
import type { ThreadMessage } from "@/store/task-store";

const isJsonPart = (part: NormalizedPart) => part.kind === "data" || /json/i.test(part.mediaType);

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
    artifact.parts.every((part) => (isJsonPart(part) && !part.mediaType.startsWith("application/vnd.agent-taskbay") && !isA2uiPart(part)) || toolType(part) !== undefined)
  );
}

const SUFFIX: Record<string, string> = { function_call: "call", tool_call: "call", tool_use: "call", executable_code: "code", function_response: "result", tool_result: "result", code_execution_result: "result" };

/** A short label for an activity artifact: the tool or function name when the JSON carries one, else the artifact name. */
export function activityLabel(artifact: AssembledArtifact): string {
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
  message.parts.filter((part) => part.kind === "text").map((part) => String(part.value)).join("\n");

export const artifactText = (artifact: AssembledArtifact) =>
  artifact.parts.filter((part) => part.kind === "text").map((part) => String(part.value)).join("");

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
