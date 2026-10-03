import { extractMessages, normalizeParts } from "../../../lib/content";
import type { DurableTaskView } from "../../../shared/task-types";
import type { JsonValue, TaskEventRecord, TaskRecord } from "../../domain/persistence-model";
import { eventDigest } from "./event-identity";
import { eventSubject, object, projectTaskEvent } from "./task-projection";

export const TASK_PROJECTOR_VERSION = 2;
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value));
const terminal = (state: string) => ["COMPLETED", "FAILED", "CANCELED", "REJECTED"].includes(state.replace("TASK_STATE_", ""));

/** Deterministic from immutable identity and ledger; old content never seeds replay. */
export function reduceTaskLedger(task: TaskRecord, agentName: string, ledger: TaskEventRecord[]): DurableTaskView {
  let view: DurableTaskView = {
    localId: task.id, taskId: task.remoteTaskId ?? task.id, tenant: task.tenant,
    agentId: task.agentId, agentName, kind: task.kind === "message" ? "message" : "task",
    state: task.kind === "message" ? "MESSAGE_ONLY" : "TASK_STATE_UNSPECIFIED",
    createdAt: task.createdAt.toISOString(), updatedAt: task.createdAt.toISOString(),
    messages: [], artifacts: [], referenceLinks: {},
  };
  let watermark = -Infinity;
  let turn = "no-user";
  const seenStatus = new Set<string>();
  const occurrences = new Map<string, Map<string, number>>();
  const snapshots = new Map<string, string>();
  const messageClocks = new Map<string, number>();
  for (const row of [...ledger].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.receivedAt.getTime() - b.receivedAt.getTime() || a.id.localeCompare(b.id))) {
    if (row.organizationId !== task.organizationId || row.agentId !== task.agentId || row.taskId !== task.id) throw new Error("Projection ledger scope mismatch.");
    const envelope = object(row.payloadJson);
    const raw = (envelope.event ?? row.payloadJson) as JsonValue;
    const { kind, subject, remoteTaskId } = eventSubject(raw);
    if (task.remoteTaskId && remoteTaskId !== task.remoteTaskId) throw new Error("Projection remote identity mismatch.");
    if (subject.tenant !== undefined && subject.tenant !== task.tenant) throw new Error("Projection tenant mismatch.");
    if (task.remoteContextId && subject.contextId && subject.contextId !== task.remoteContextId) throw new Error("Projection context mismatch.");
    const context = object(envelope.projectionContext);
    const epoch = typeof context.turnId === "string" ? context.turnId : turn;
    const stamp = row.remoteTimestamp?.getTime() ?? -Infinity;
    const status = object(subject.status);
    const state = typeof status.state === "string" ? status.state : undefined;
    const stale = row.remoteTimestamp !== null && stamp < watermark || terminal(view.state) && state !== undefined && state !== view.state;
    // Old snapshots must not replace newer message or artifact content.
    if (stale && kind === "task") continue;
    const messages = extractMessages(raw).flatMap((message) => {
      const normalized = { ...message, role: ["user", "ROLE_USER"].includes(String(message.role)) ? "ROLE_USER" : "ROLE_AGENT" };
      const contentIdentity = (value: Record<string, unknown>) => eventDigest(json({
        role: ["user", "ROLE_USER"].includes(String(value.role)) ? "ROLE_USER" : "ROLE_AGENT",
        parts: normalizeParts(value.parts), metadata: value.metadata ?? null,
      }));
      const id = String(message.messageId || `derived:${eventDigest(json({ content: contentIdentity(message), turn: epoch }))}`);
      const clock = stamp === -Infinity ? row.receivedAt.getTime() : stamp;
      if (clock < (messageClocks.get(id) ?? -Infinity)) return [];
      messageClocks.set(id, clock);
      if (normalized.role === "ROLE_USER") turn = id;
      const prompt = object(status.message);
      const fromStatus = prompt.messageId ? prompt.messageId === id : Boolean(status.message) && contentIdentity(prompt) === contentIdentity(message);
      return [{ message: { ...normalized, messageId: id }, fromStatus }];
    });
    // Project one message at a time, giving no-ID messages the same identity
    // whether they arrive in a status, history, or direct message envelope.
    for (const { message, fromStatus } of messages) {
      view = projectTaskEvent(view, json({ message }), row.receivedAt.toISOString(), message.messageId, false);
      if (fromStatus) {
        const projected = view.messages.find((item) => item.id === message.messageId);
        if (projected) projected.fromStatus = true;
      }
    }
    const cleanSubject = { ...subject };
    delete cleanSubject.history;
    if (kind === "message") continue;
    if (subject.status) {
      const cleanStatus = { ...status }; delete cleanStatus.message;
      const key = eventDigest(json({ state, timestamp: status.timestamp ?? null, turn: stamp === -Infinity ? epoch : null }));
      const accept = !stale && !seenStatus.has(key);
      if (accept) { seenStatus.add(key); watermark = Math.max(watermark, stamp); }
      cleanSubject.status = accept ? cleanStatus : {};
    }
    if (Array.isArray(subject.artifacts)) {
      cleanSubject.artifacts = subject.artifacts.filter((artifact) => {
        const value = object(artifact);
        const key = eventDigest(json({ artifact: value, complete: true }));
        const id = String(value.artifactId);
        const duplicate = snapshots.get(id) === key;
        snapshots.set(id, key);
        return !duplicate;
      });
    }
    if (["artifactUpdate", "taskArtifactUpdate"].includes(kind)) {
      const artifact = object(subject.artifact);
      const signature = eventDigest(json({ artifact, append: Boolean(subject.append), lastChunk: Boolean(subject.lastChunk), turn: epoch }));
      const sources = occurrences.get(signature) ?? new Map<string, number>();
      const occurrence = (sources.get(row.source) ?? 0) + 1;
      const previousMaximum = Math.max(0, ...sources.values());
      sources.set(row.source, occurrence); occurrences.set(signature, sources);
      if (subject.append && occurrence <= previousMaximum) continue;
      if (subject.append) snapshots.delete(String(artifact.artifactId));
      if (!subject.append) {
        const key = eventDigest(json({ artifact, complete: Boolean(subject.lastChunk) }));
        if (snapshots.get(String(artifact.artifactId)) === key) continue;
        snapshots.set(String(artifact.artifactId), key);
        view.artifacts = view.artifacts.filter((item) => item.artifactId !== artifact.artifactId);
      }
    }
    view = projectTaskEvent(view, json({ [kind]: cleanSubject }), row.receivedAt.toISOString(), row.payloadDigest);
  }
  // Receipt time belongs to the ledger, never the wall clock at rebuild time.
  view.updatedAt = ledger.reduce((latest, row) => row.receivedAt.toISOString() > latest ? row.receivedAt.toISOString() : latest, view.createdAt);
  return json(view) as unknown as DurableTaskView;
}
