import { isA2uiPart } from "@/lib/a2ui";
import { describeData, taggedKind } from "@/lib/data-part";
import type { AssembledArtifact, NormalizedPart } from "@/lib/types";
import { isActiveState, stateName } from "@/lib/task-view";
import type { ThreadMessage, TrackedTask } from "@/store/task-store";

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

/**
 * A tool call or result, code or its output: tagged by the agent framework, or shaped like one (see `describeData`).
 * Taskbay's own media types and A2UI surfaces are never tool traffic.
 */
export function isToolPart(part: NormalizedPart): boolean {
  if (taggedKind(part)) return true;
  if (!isJsonPart(part) || part.mediaType.startsWith("application/vnd.agent-taskbay") || isA2uiPart(part)) return false;
  return ["tool-call", "tool-result", "code", "code-result"].includes(describeData(part).kind);
}

/** Reasoning sent as structured data (Anthropic `thinking`, Vercel `reasoning`). */
const isReasoningData = (part: NormalizedPart) => isJsonPart(part) && !isA2uiPart(part) && describeData(part).kind === "reasoning";

const isActivityPart = (part: NormalizedPart) => isToolPart(part) || isReasoningPart(part) || isReasoningData(part);

export function isActivityMessage(message: Pick<ThreadMessage, "parts">): boolean {
  return message.parts.length > 0 && message.parts.every(isActivityPart);
}

/**
 * An artifact that is only structured data, such as a tool call or its result. It is background activity, not an
 * answer: it folds into the activity log instead of getting a card. Forms, approval requests and A2UI surfaces are
 * Taskbay's own media types and stay as they are.
 */
export function isActivityArtifact(artifact: AssembledArtifact): boolean {
  return artifact.parts.length > 0 && artifact.parts.every(isActivityPart);
}

/**
 * The sub-agent that wrote a status update (Google ADK sets `adk_author`), or null when it is the agent itself or
 * unknown, so the log only names an author when it adds something.
 */
export function statusAuthor(message: Pick<ThreadMessage, "metadata">, agentName: string): string | null {
  const author = message.metadata?.adk_author;
  if (typeof author !== "string" || !author.trim()) return null;
  return author.trim().toLowerCase() === agentName.trim().toLowerCase() ? null : author.trim();
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

/**
 * Decides where each message of a task goes. Tool-only agent messages fold into the activity log. An update (status
 * text the agent sends while it works, or an agent message followed straight away by another agent message) folds
 * into the progress log. Once the task stops working, to ask you something or because it ended, its last message is
 * the agent speaking to you and stays in the conversation, unless it is only tool traffic, repeats a finished result,
 * or was a working update followed by results.
 */
export function planMessages(task: Pick<TrackedTask, "kind" | "state" | "messages">, results: AssembledArtifact[]) {
  const { messages } = task;
  const lastIndex = messages.length - 1;
  const isTask = task.kind !== "message";
  const activityMessages = messages.filter((message) => message.role === "agent" && !message.fromStatus && isActivityMessage(message));
  const activityIds = new Set(activityMessages.map((message) => message.id));
  const isWorking = (state: string) => ["SUBMITTED", "WORKING"].includes(stateName(state));
  // A status message the agent sent while still working ("Summarizing…") is progress even when nothing followed it,
  // unless the task produced no result, in which case it is all the agent said.
  const speaks = (index: number) => {
    const message = messages[index];
    if (index !== lastIndex || isWorking(task.state) || isActivityMessage(message)) return false;
    return !(message.fromStatus && message.statusState && isWorking(message.statusState) && results.length > 0);
  };
  const isUpdate = (index: number) => {
    const message = messages[index];
    return isTask && message?.role === "agent" && !activityIds.has(message.id) && !speaks(index) &&
      (Boolean(message.fromStatus) || (index !== lastIndex && messages[index + 1]?.role === "agent"));
  };
  // The last message is dropped when it only repeats a finished result, so the answer appears once.
  const repeated = isTask && !isActiveState(task.state) && lastIndex >= 0 && messages[lastIndex].role === "agent" && repeatsArtifact(messages[lastIndex], results);
  return { activityMessages, isUpdate, repeated };
}
