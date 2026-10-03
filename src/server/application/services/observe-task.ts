import { createHash, randomUUID } from "node:crypto";
import type { DurableTaskView } from "../../../shared/task-types";
import type { JsonValue, TaskRecord, TaskEventSource } from "../../domain/persistence-model";
import type { AgentRepository, TaskRepository, TaskEventRepository } from "../ports/persistence";
import type { Clock } from "../ports/clock";
import type { StreamMetadata } from "../ports/subscriptions";
import { eventSubject, object } from "./task-projection";

import { eventDigest } from "./event-identity";
export { canonicalJson, eventDigest } from "./event-identity";
import { reduceTaskLedger, TASK_PROJECTOR_VERSION } from "./versioned-task-projection";

export interface TaskObservation {
  organizationId: string;
  agentId: string;
  tenant: string;
  event: JsonValue;
  payloadDigest?: string;
  originalEventObjectKey?: string;
  source: TaskEventSource;
  sourceKey: string;
  stableSourceIdentity?: boolean;
  sessionId: string;
  requestId: string;
  directThreadId: string;
  userMessage?: JsonValue;
  userMessagePayloadDigest?: string;
  userMessageOriginalObjectKey?: string;
  streamMetadata?: StreamMetadata;
}

export class ObserveTaskService {
  constructor(
    private readonly agents: AgentRepository,
    private readonly tasks: TaskRepository,
    private readonly events: TaskEventRepository,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  /** The runtime adapter wraps this entire operation in one database transaction. */
  async observe(input: TaskObservation): Promise<DurableTaskView> {
    const agent = await this.agents.findById(input.organizationId, input.agentId);
    if (!agent) throw new Error("Unknown agent in organization.");
    const { subject, kind, remoteTaskId } = eventSubject(input.event);
    if (kind !== "message" && !remoteTaskId) throw new Error("Task observation requires a remote task ID.");
    const now = this.clock.now();
    // Stable local UUID for a direct Message; it remains a nullable-remote-ID row.
    const messageIdentity = !remoteTaskId && typeof subject.messageId === "string" && subject.messageId;
    const identityHex = messageIdentity ? createHash("sha256").update(JSON.stringify([agent.id, input.tenant, messageIdentity])).digest("hex") : undefined;
    const directId = identityHex ? `${identityHex.slice(0, 8)}-${identityHex.slice(8, 12)}-8${identityHex.slice(13, 16)}-a${identityHex.slice(17, 20)}-${identityHex.slice(20, 32)}` : input.directThreadId;
    const task = await this.tasks.getOrCreate({
      id: remoteTaskId ? randomUUID() : directId,
      organizationId: input.organizationId, agentId: input.agentId, tenant: input.tenant,
      remoteTaskId: remoteTaskId || null, remoteContextId: typeof subject.contextId === "string" ? subject.contextId : null,
      kind: remoteTaskId ? "task" : "message", state: remoteTaskId ? "TASK_STATE_UNSPECIFIED" : "MESSAGE_ONLY",
      title: null, ownerUserId: null, ownerTeamId: null, createdAt: now, remoteCreatedAt: null,
      updatedAt: now, remoteUpdatedAt: null, terminalAt: null, version: 1, contentJson: {},
    });
    let view: DurableTaskView = {
      taskId: task.remoteTaskId ?? task.id, agentId: agent.id, agentName: agent.displayName ?? "Agent",
      kind: task.kind === "message" ? "message" : "task", state: task.state,
      createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(), messages: [], artifacts: [],
      ...object(task.contentJson), localId: task.id, tenant: task.tenant, referenceLinks: {},
    } as DurableTaskView;
    let changed = false;
    const append = async (event: JsonValue, source: TaskEventSource, sourceKey: string, digest = eventDigest(event), originalEventObjectKey?: string) => {
      const current = eventSubject(event);
      // A new user turn can repeat bytes or an untimestamped lifecycle prompt.
      // Reconnect replays within that turn keep the same epoch and occurrence.
      const lastUser = view.messages.filter((message) => message.role === "user").at(-1)?.id ?? "no-user";
      const timestamp = object(current.subject.status).timestamp;
      const remoteTimestamp = typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp) : null;
      const turnScoped = current.subject.append === true || !remoteTimestamp && ["task", "statusUpdate", "taskStatusUpdate"].includes(current.kind);
      const deduplicationKey = turnScoped && !input.stableSourceIdentity
        ? `${sourceKey}:turn:${createHash("sha256").update(lastUser).digest("hex")}`
        : sourceKey;
      const inserted = await this.events.appendIfAbsent({
        id: randomUUID(), organizationId: input.organizationId, agentId: agent.id, taskId: task.id,
        source, sourceKey: deduplicationKey, eventKind: current.kind, receivedAt: now, remoteTimestamp,
        payloadDigest: digest, payloadJson: {
          event, ...(originalEventObjectKey ? { originalEventObjectKey } : {}),
          ...(input.streamMetadata ? { streamMetadata: { ...input.streamMetadata } } : {}),
          projectionContext: { turnId: lastUser, stableSourceIdentity: Boolean(input.stableSourceIdentity), projectorKey: sourceKey },
        },
        sessionId: input.sessionId, requestId: input.requestId, traceId: null, projectionVersion: TASK_PROJECTOR_VERSION,
      });
      if (!inserted) return;
      if (current.kind === "message" && ["ROLE_USER", "user"].includes(String(current.subject.role))) {
        const id = String(current.subject.messageId ?? sourceKey);
        view.messages = [...view.messages.filter((message) => message.id !== id), { id, role: "user", parts: [], timestamp: now.toISOString() }];
      }
      changed = true;
    };
    if (input.userMessage) {
      const message = object(input.userMessage);
      await append({ message: { ...message, taskId: task.remoteTaskId ?? "", contextId: task.remoteContextId ?? "" } } as JsonValue,
        "command_response", `user:${eventDigest({ messageId: String(message.messageId) })}`,
        input.userMessagePayloadDigest, input.userMessageOriginalObjectKey);
    }
    await append(input.event, input.source, input.sourceKey, input.payloadDigest, input.originalEventObjectKey);
    if (changed) {
      const ledger = await this.events.findByTaskId(input.organizationId, task.id);
      view = reduceTaskLedger(task, agent.displayName ?? "Agent", ledger);
      const terminal = ["COMPLETED", "FAILED", "CANCELED", "REJECTED"].includes(view.state.replace("TASK_STATE_", ""));
      const projection: TaskRecord = {
        ...task, state: view.state, remoteContextId: view.contextId ?? task.remoteContextId,
        title: view.title ?? task.title, updatedAt: now, terminalAt: terminal ? task.terminalAt ?? now : null,
        projectionVersion: TASK_PROJECTOR_VERSION,
        remoteUpdatedAt: ledger.reduce<Date | null>((latest, row) => row.remoteTimestamp && (!latest || row.remoteTimestamp > latest) ? row.remoteTimestamp : latest, null),
        contentJson: JSON.parse(JSON.stringify(view)) as JsonValue,
      };
      await this.tasks.saveProjection(projection);
    }
    return view;
  }
}
