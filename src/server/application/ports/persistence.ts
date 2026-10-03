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

export interface TaskRepository {
  /** Called within an ingestion transaction; returns a row locked for projection updates. */
  getOrCreate(task: TaskRecord): Promise<TaskRecord>;
  saveProjection(task: TaskRecord): Promise<TaskRecord>;
  listByOrganization(organizationId: string, limit: number, offset: number, filter?: string): Promise<TaskSummaryRecord[]>;
  findById(
    organizationId: string,
    id: string,
  ): Promise<TaskRecord | undefined>;
  findByRemoteIdentity(identity: {
    organizationId: string;
    agentId: string;
    tenant: string;
    remoteTaskId: string;
  }): Promise<TaskRecord | undefined>;
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
  update(organizationId: string, id: string, changes: Pick<TaskCommandRecord, "status" | "resultJson" | "lastError" | "updatedAt">): Promise<void>;
}
