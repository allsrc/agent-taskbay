import { assembleArtifacts, extractMessages, normalizeParts } from "../../../lib/content";
import type { DurableTaskView, ThreadMessage } from "../../../shared/task-types";
import type { JsonValue } from "../../domain/persistence-model";

export const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function eventSubject(event: JsonValue) {
  const value = object(event);
  for (const key of ["task", "statusUpdate", "taskStatusUpdate", "artifactUpdate", "taskArtifactUpdate", "message"]) {
    if (value[key]) {
      const subject = object(value[key]);
      return { kind: key, subject, remoteTaskId: String(key === "task" ? subject.id ?? "" : subject.taskId ?? "") };
    }
  }
  throw new Error("Unsupported task observation.");
}

export function projectTaskEvent(base: DurableTaskView, event: JsonValue, receivedAt: string, eventKey: string, acceptStatus = true): DurableTaskView {
  const { subject, kind } = eventSubject(event);
  const status = object(subject.status);
  const messages = new Map(base.messages.map((message) => [message.id, message]));
  const statusMessageId = object(status.message).messageId;
  for (const [index, raw] of extractMessages(event).entries()) {
    const id = String(raw.messageId || `${eventKey}:message:${index}`);
    const known = messages.get(id);
    const message: ThreadMessage = {
      id, role: ["ROLE_USER", "user"].includes(String(raw.role)) ? "user" : "agent",
      parts: normalizeParts(raw.parts), timestamp: known?.timestamp ?? receivedAt,
      contextId: typeof raw.contextId === "string" ? raw.contextId : base.contextId,
      taskId: base.taskId,
      metadata: raw.metadata ? object(raw.metadata) : undefined,
      referenceTaskIds: Array.isArray(raw.referenceTaskIds) ? raw.referenceTaskIds.map(String) : undefined,
      fromStatus: known?.fromStatus || (statusMessageId !== undefined && statusMessageId === raw.messageId),
    };
    messages.set(id, message);
  }
  const seededArtifacts = base.artifacts.map((artifact) => ({ artifactUpdate: {
    artifact: { ...artifact, parts: artifact.parts.map((part) => ({
      [part.kind === "text" ? "text" : part.kind === "data" ? "data" : "url"]: part.value,
      mediaType: part.mediaType, filename: part.filename, metadata: part.metadata,
    })) }, lastChunk: artifact.complete,
  } }));
  const touchesArtifact = kind.includes("Artifact") || kind === "artifactUpdate" || Array.isArray(subject.artifacts);
  const artifacts = touchesArtifact ? assembleArtifacts([...seededArtifacts, event]).map((artifact) => {
    const previous = base.artifacts.find((item) => item.artifactId === artifact.artifactId);
    return { ...artifact, updateCount: artifact.updateCount - (previous ? 1 : 0) + (previous?.updateCount ?? 0) };
  }) : base.artifacts;
  const nextState = acceptStatus && typeof status.state === "string" ? status.state : base.state;
  const transitions = [...(base.transitions ?? [])];
  if (nextState !== base.state || !transitions.length && kind === "task") {
    transitions.push({ state: nextState, timestamp: typeof status.timestamp === "string" ? status.timestamp : receivedAt });
  }
  const userText = [...messages.values()].find((message) => message.role === "user")?.parts.find((part) => part.kind === "text");
  return {
    ...base, contextId: typeof subject.contextId === "string" && subject.contextId ? subject.contextId : base.contextId,
    state: nextState, transitions, messages: [...messages.values()], artifacts, updatedAt: receivedAt,
    title: base.title ?? (userText ? String(userText.value).trim().slice(0, 500) : undefined),
  };
}
