import { assembleArtifacts, assembleTasks, normalizeParts } from "./content";
import type { OutgoingPart } from "./message-parts";
import type { AssembledArtifact } from "./types";
import type { SendConfig, StatusTransition, ThreadMessage, TrackedTask } from "../store/task-store";

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const asString = (value: unknown) => (typeof value === "string" && value ? value : undefined);

export function userThreadMessage(parts: OutgoingPart[], ids: { contextId?: string; taskId?: string }, config?: SendConfig): ThreadMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    parts: normalizeParts(parts),
    timestamp: new Date().toISOString(),
    contextId: ids.contextId,
    taskId: ids.taskId,
    referenceTaskIds: config?.referenceTaskIds?.length ? config.referenceTaskIds : undefined,
    metadata: config?.metadata,
  };
}

function toThreadMessage(raw: JsonObject, fromStatus = false): ThreadMessage {
  return {
    id: String(raw.messageId ?? crypto.randomUUID()),
    role: raw.role === "ROLE_USER" || raw.role === "user" ? "user" : "agent",
    parts: normalizeParts(raw.parts),
    timestamp: new Date().toISOString(),
    contextId: asString(raw.contextId),
    taskId: asString(raw.taskId),
    metadata: isObject(raw.metadata) ? raw.metadata : undefined,
    referenceTaskIds: Array.isArray(raw.referenceTaskIds) && raw.referenceTaskIds.length ? raw.referenceTaskIds.map(String) : undefined,
    fromStatus,
  };
}

function mergeMessages(existing: ThreadMessage[], incoming: ThreadMessage[]): ThreadMessage[] {
  const seen = new Map(existing.map((message) => [message.id, message]));
  const merged = [...existing];
  for (const message of incoming) {
    if (message.role === "user") continue; // the user's own turn is added locally with its own id
    const known = seen.get(message.id);
    if (known) {
      merged[merged.indexOf(known)] = { ...message, timestamp: known.timestamp };
    } else {
      merged.push(message);
      seen.set(message.id, message);
    }
  }
  return merged;
}

function mergeArtifacts(existing: AssembledArtifact[], incoming: AssembledArtifact[]): AssembledArtifact[] {
  const incomingIds = new Set(incoming.map((artifact) => artifact.artifactId));
  return [...existing.filter((artifact) => !incomingIds.has(artifact.artifactId)), ...incoming];
}

function collectTransitions(events: unknown[], existing: StatusTransition[] = []): StatusTransition[] {
  const sequence: StatusTransition[] = [];
  const push = (status: unknown) => {
    if (!isObject(status) || typeof status.state !== "string") return;
    if (sequence.at(-1)?.state === status.state) return;
    sequence.push({ state: status.state, timestamp: asString(status.timestamp) ?? new Date().toISOString() });
  };
  for (const event of events) {
    if (!isObject(event)) continue;
    if (isObject(event.task)) push(event.task.status);
    if (isObject(event.statusUpdate)) push(event.statusUpdate.status);
    if (isObject(event.taskStatusUpdate)) push(event.taskStatusUpdate.status);
  }
  // A snapshot that restates the state we already recorded is not a transition.
  const skip = sequence[0] && sequence[0].state === existing.at(-1)?.state ? 1 : 0;
  return [...existing, ...sequence.slice(skip)];
}

/**
 * Folds raw A2A stream events into the tracked-task view. `SendMessageResponse`
 * is a Task *or* a Message: with a Task we track its lifecycle; with only a
 * Message the agent answered directly and there is no task to track.
 */
export function applyEvents(events: unknown[], base: TrackedTask, localReplyId: string): TrackedTask {
  const now = new Date().toISOString();
  const tasks = assembleTasks(events);
  const task = tasks.find((candidate) => candidate.id === base.taskId) ?? tasks[0];

  if (!task) {
    const replies = events.flatMap((event) => (isObject(event) && isObject(event.message) ? [toThreadMessage(event.message)] : []));
    if (!replies.length) return base;
    return {
      ...base,
      taskId: base.taskId || localReplyId,
      contextId: replies.find((message) => message.contextId)?.contextId ?? base.contextId,
      updatedAt: now,
      messages: mergeMessages(base.messages, replies),
    };
  }

  const status = isObject(task.status) ? task.status : {};
  const history = (Array.isArray(task.history) ? task.history : []).filter(isObject).map((item) => toThreadMessage(item));
  const statusMessage = isObject(status.message) ? toThreadMessage(status.message, true) : undefined;
  const incoming = [...history];
  if (statusMessage) {
    const at = incoming.findIndex((message) => message.id === statusMessage.id);
    if (at >= 0) incoming[at] = { ...incoming[at], fromStatus: true };
    else incoming.push(statusMessage);
  }
  // Task-scoped messages that arrived standalone (not in history yet).
  for (const event of events) {
    if (isObject(event) && isObject(event.message) && event.message.taskId === task.id) incoming.push(toThreadMessage(event.message));
  }

  return {
    ...base,
    taskId: String(task.id),
    kind: "task",
    contextId: asString(task.contextId) ?? base.contextId,
    state: asString(status.state) ?? base.state,
    transitions: collectTransitions(events, base.transitions),
    updatedAt: now,
    messages: mergeMessages(base.messages, incoming),
    artifacts: mergeArtifacts(base.artifacts, assembleArtifacts(events)),
  };
}

