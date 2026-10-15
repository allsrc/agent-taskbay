import type { TaskDiscoveryMode, TaskOrigin } from "../../domain/discovery-mode";
import type { TaskListCursor } from "../../domain/task-cursor";
import type {
  AgentCardSnapshotRecord,
  AgentRecord,
  OrganizationRecord,
  OutboxMessageRecord,
  TaskEventRecord,
  TaskRecord,
  TaskSummaryRecord,
  TaskCommandRecord,
  SubscriptionRecord,
} from "../../domain/persistence-model";

export interface OrganizationRepository {
  findById(id: string): Promise<OrganizationRecord | undefined>;
  findBySlug(slug: string): Promise<OrganizationRecord | undefined>;
  getOrCreate(organization: OrganizationRecord): Promise<OrganizationRecord>;
}

export interface AgentRepository {
  listByOrganization(organizationId: string): Promise<AgentRecord[]>;
  getOrCreate(agent: AgentRecord): Promise<AgentRecord>;
  updateRegistration(
    organizationId: string,
    id: string,
    registration: Pick<AgentRecord, "source" | "enabled" | "updatedAt">,
  ): Promise<boolean>;
  setExtensionOverride(organizationId: string, id: string, extensionOverride: boolean, now: Date): Promise<boolean>;
  /** Changes an agent's task discovery settings. Rejects an unknown mode or a history outside 0 to 90 days. */
  setTaskDiscovery(
    organizationId: string,
    id: string,
    change: { taskDiscovery?: TaskDiscoveryMode; taskDiscoveryHistoryDays?: number; taskDiscoveryPausedReason?: string | null },
    now: Date,
  ): Promise<boolean>;
  updateDiscovery(
    organizationId: string,
    id: string,
    discovery: Pick<AgentRecord, "displayName" | "description" | "protocolSnapshotVersion" | "lastDiscoveryAt" | "lastHealthyAt" | "updatedAt">,
  ): Promise<boolean>;
  findById(
    organizationId: string,
    id: string,
  ): Promise<AgentRecord | undefined>;
  findByCardUrl(
    organizationId: string,
    cardUrl: string,
  ): Promise<AgentRecord | undefined>;
  insert(agent: AgentRecord): Promise<AgentRecord>;
  appendCardSnapshot(
    snapshot: AgentCardSnapshotRecord,
  ): Promise<AgentCardSnapshotRecord>;
  findLatestCardSnapshot(
    agentId: string,
  ): Promise<AgentCardSnapshotRecord | undefined>;
}

/** Filters apply inside the caller's visibility and can only narrow it. `after` replaces `offset`. */
export interface TaskListQuery {
  limit: number;
  offset?: number;
  filter?: string;
  restriction?: { include?: string[]; exclude?: string[] };
  origin?: TaskOrigin;
  contextId?: string;
  agentId?: string;
  /** Not exposed on the HTTP list; used with `contextId` to find the tasks of one context. */
  tenant?: string;
  updatedAfter?: Date;
  after?: TaskListCursor;
}

export interface TaskRepository {
  /** Stable local-ID pagination includes direct Messages, without reading the ledger. */
  listContentPage(organizationId: string, limit: number, after?: string): Promise<TaskRecord[]>;
  /** Called within an ingestion transaction; returns a row locked for projection updates. */
  getOrCreate(task: TaskRecord): Promise<TaskRecord>;
  saveProjection(task: TaskRecord): Promise<TaskRecord>;
  /** Workflow views (mine, overdue, unassigned) are active-only and narrowed by task IDs supplied by the caller. */
  listByOrganization(organizationId: string, query: TaskListQuery): Promise<TaskSummaryRecord[]>;
  findById(
    organizationId: string,
    id: string,
    /** Rebuild reads only immutable identity/typed columns, even if content rows are damaged. */
    includeContent?: boolean,
  ): Promise<TaskRecord | undefined>;
  findByRemoteIdentity(identity: {
    organizationId: string;
    agentId: string;
    tenant: string;
    remoteTaskId: string;
  }): Promise<TaskRecord | undefined>;
  /** The stored tasks among these remote IDs for one agent and tenant, restricted to what the caller may see. */
  findManyByRemoteIds(identity: { organizationId: string; agentId: string; tenant: string; remoteTaskIds: string[] }): Promise<Array<Pick<TaskRecord, "id" | "remoteTaskId" | "state">>>;
  /** Tasks stored because someone tracked them or automatic discovery found them. */
  countDiscovered(organizationId: string, agentId: string): Promise<number>;
  insert(task: TaskRecord): Promise<TaskRecord>;
}

export interface TaskEventRepository {
  readFeed(organizationId: string, taskId: string, after: number, limit: number): Promise<TaskEventRecord[]>;
  appendIfAbsent(event: TaskEventRecord): Promise<boolean>;
  findByTaskId(
    organizationId: string,
    taskId: string,
  ): Promise<TaskEventRecord[]>;
}

export interface SubscriptionRepository {
  /** In the ingestion transaction, create/rearm active tasks or stop paused/terminal tasks. */
  sync(task: TaskRecord, now: Date): Promise<void>;
  findByTaskId(organizationId: string, taskId: string): Promise<SubscriptionRecord | undefined>;
  claim(owner: string, now: Date, until: Date): Promise<SubscriptionRecord | undefined>;
  renew(subscription: SubscriptionRecord, now: Date, until: Date): Promise<boolean>;
  finish(subscription: SubscriptionRecord, now: Date, changes: Pick<SubscriptionRecord, "status" | "availableAt" | "lastError">): Promise<boolean>;
}

export interface OutboxRepository {
  /** Must be called inside a transaction. Reclaimed leases are uncertain. */
  claim(topic: string, owner: string, now: Date, leaseUntil: Date): Promise<{ message: OutboxMessageRecord; recovered: boolean } | undefined>;
  renew(id: string, organizationId: string, owner: string, now: Date, until: Date): Promise<boolean>;
  finish(id: string, organizationId: string, owner: string, now: Date, changes: Pick<OutboxMessageRecord, "status" | "availableAt" | "lastError" | "processedAt">): Promise<boolean>;
  enqueue(message: OutboxMessageRecord): Promise<OutboxMessageRecord>;
  findById(
    organizationId: string,
    id: string,
  ): Promise<OutboxMessageRecord | undefined>;
}

export interface TaskCommandRepository {
  getOrCreate(command: TaskCommandRecord): Promise<{ command: TaskCommandRecord; created: boolean }>;
  findById(organizationId: string, id: string): Promise<TaskCommandRecord | undefined>;
  /** The `send` commands for these message ids on one agent and tenant, in one query. */
  findSendsByMessageIds(organizationId: string, agentId: string, tenant: string, messageIds: string[]): Promise<TaskCommandRecord[]>;
  /** `send` commands for the agent and tenant created at or after `since` that did not succeed (their message may never have reached the task). Newest first. */
  listUnsettledSends(organizationId: string, agentId: string, tenant: string, since: Date, limit: number): Promise<TaskCommandRecord[]>;
  update(organizationId: string, id: string, changes: Pick<TaskCommandRecord, "status" | "resultJson" | "lastError" | "updatedAt"> & { errorKind?: string | null }): Promise<void>;
}
