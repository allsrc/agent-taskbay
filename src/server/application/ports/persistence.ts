import type {
  AgentCardSnapshotRecord,
  AgentRecord,
  OrganizationRecord,
  OutboxMessageRecord,
  TaskEventRecord,
  TaskRecord,
} from "../../domain/persistence-model";

export interface OrganizationRepository {
  findById(id: string): Promise<OrganizationRecord | undefined>;
  findBySlug(slug: string): Promise<OrganizationRecord | undefined>;
  getOrCreate(organization: OrganizationRecord): Promise<OrganizationRecord>;
}

export interface AgentRepository {
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
