import type { AgentRecord, JsonValue, SyncCursorRecord, TaskRecord } from "../../domain/persistence-model";
import type { AgentRepository, TaskRepository } from "./persistence";

export const SYNC_LEASE_MS = 15_000;
export const terminalTask = (state: string) => ["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"].includes(state);
export interface SyncCursorRepository {
  sync(task: TaskRecord, now: Date): Promise<void>;
  claim(owner: string, now: Date, until: Date): Promise<SyncCursorRecord | undefined>;
  renew(cursor: SyncCursorRecord, now: Date, until: Date): Promise<boolean>;
  finish(cursor: SyncCursorRecord, now: Date, changes: Pick<SyncCursorRecord, "status" | "availableAt" | "lastError" | "pageToken" | "lastSyncedAt">): Promise<boolean>;
  find(organizationId: string, agentId: string, tenant: string, resourceKey: string): Promise<SyncCursorRecord | undefined>;
  knownTasks(cursor: SyncCursorRecord): Promise<TaskRecord[]>;
}
export interface ReconciliationUnitOfWork {
  run<T>(work: (ports: { agents: AgentRepository; tasks: TaskRepository; syncCursors: SyncCursorRepository }) => Promise<T>): Promise<T>;
}
export interface A2AReconciliationGateway {
  get(agent: AgentRecord, task: TaskRecord, signal: AbortSignal): Promise<JsonValue>;
  list(agent: AgentRecord, cursor: SyncCursorRecord, signal: AbortSignal): Promise<{ tasks: JsonValue[]; nextPageToken: string }>;
}
export interface ReconciliationSink {
  /** Ingest under a task-version check and unexpired lease fence. False means a concurrent update won. */
  ingest(cursor: SyncCursorRecord, task: TaskRecord, event: JsonValue): Promise<boolean>;
}
export class ListTasksUnsupported extends Error {}
