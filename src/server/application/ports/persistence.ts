import type {
  AgentCardSnapshotRecord,
  AgentRecord,
  OrganizationRecord,
  OutboxMessageRecord,
  TaskEventRecord,
  TaskRecord,
  TaskSummaryRecord,
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
  appendIfAbsent(event: TaskEventRecord): Promise<boolean>;
  findByTaskId(
    organizationId: string,
    taskId: string,
  ): Promise<TaskEventRecord[]>;
}

export interface OutboxRepository {
  enqueue(message: OutboxMessageRecord): Promise<OutboxMessageRecord>;
  findById(
    organizationId: string,
    id: string,
  ): Promise<OutboxMessageRecord | undefined>;
}
