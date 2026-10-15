import type { AgentRecord, JsonValue, SyncCursorRecord, TaskRecord } from "../../domain/persistence-model";
import type { AgentRepository, TaskRepository } from "./persistence";

export const SYNC_LEASE_MS = 15_000;
export const terminalTask = (state: string) => ["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"].includes(state);
export type CursorFinish = Pick<SyncCursorRecord, "status" | "availableAt" | "lastError" | "pageToken" | "lastSyncedAt">
  & Partial<Pick<SyncCursorRecord, "lastFullSweepAt" | "sweepStartedAt" | "sweepFound" | "sweepAfter">>;
export interface SyncCursorRepository {
  sync(task: TaskRecord, now: Date): Promise<void>;
  claim(owner: string, now: Date, until: Date): Promise<SyncCursorRecord | undefined>;
  renew(cursor: SyncCursorRecord, now: Date, until: Date): Promise<boolean>;
  finish(cursor: SyncCursorRecord, now: Date, changes: CursorFinish): Promise<boolean>;
  find(organizationId: string, agentId: string, tenant: string, resourceKey: string): Promise<SyncCursorRecord | undefined>;
  knownTasks(cursor: SyncCursorRecord): Promise<TaskRecord[]>;
  /** The agent's whole-agent list cursors (one per tenant), for status display. */
  listCursors(organizationId: string, agentId: string): Promise<SyncCursorRecord[]>;
  /** Creates the agent's whole-agent list cursors for these tenants, so automatic discovery has something to claim. `reset` also restarts stopped, unsupported or waiting ones, so the first sweep happens now (used when the mode changes). */
  startDiscovery(organizationId: string, agentId: string, tenants: string[], now: Date, reset: boolean): Promise<void>;
  /** Tenants of the agent's stored tasks. */
  taskTenants(organizationId: string, agentId: string): Promise<string[]>;
}
export interface ReconciliationUnitOfWork {
  run<T>(work: (ports: { agents: AgentRepository; tasks: TaskRepository; syncCursors: SyncCursorRepository }) => Promise<T>): Promise<T>;
}
/** Automatic discovery asks only for what changed, with a little history so a newly found task reads well. */
export interface ListOptions { statusTimestampAfter?: Date | null; historyLength?: number }
export interface A2AReconciliationGateway {
  /** One `GetTask`. `historyLength` asks the agent for that many of its most recent history messages; omitted, the agent decides. */
  get(agent: AgentRecord, task: TaskRecord, signal: AbortSignal, historyLength?: number): Promise<JsonValue>;
  list(agent: AgentRecord, cursor: SyncCursorRecord, signal: AbortSignal, options?: ListOptions): Promise<{ tasks: JsonValue[]; nextPageToken: string }>;
}
export interface ReconciliationSink {
  /** Ingest under a task-version check and unexpired lease fence. False means a concurrent update won. */
  ingest(cursor: SyncCursorRecord, task: TaskRecord, event: JsonValue): Promise<boolean>;
  /** Automatic discovery: store a task found on the agent. Fenced by the same lease. */
  discover?(cursor: SyncCursorRecord, event: JsonValue): Promise<boolean>;
  /** After a page: tell the audit trail what was found. */
  report?(cursor: SyncCursorRecord, found: number): Promise<void>;
  /** Stop discovering for this agent and say why. */
  pause?(cursor: SyncCursorRecord, reason: string): Promise<void>;
}
/** What mode an agent is in right now: its own setting under the deployment's cap. */
export interface DiscoveryPolicy { mode(agent: AgentRecord): "off" | "browse" | "auto" }
export class ListTasksUnsupported extends Error {}
