import type { EntityManager, QueryResult } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/sql";

import type {
  AgentRepository,
  OrganizationRepository,
  OutboxRepository,
  TaskEventRepository,
  TaskRepository,
} from "../../application/ports/persistence";
import type {
  AgentCardSnapshotRecord,
  AgentRecord,
  OrganizationRecord,
  OutboxMessageRecord,
  TaskEventRecord,
  TaskRecord,
} from "../../domain/persistence-model";
import {
  AgentCardSnapshotEntity,
  AgentEntity,
  OrganizationEntity,
  OutboxMessageEntity,
  TaskEntity,
  TaskEventEntity,
} from "./entities";

function organizationRecord(entity: OrganizationEntity): OrganizationRecord {
  return {
    id: entity.id,
    slug: entity.slug,
    name: entity.name,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

function agentRecord(entity: AgentEntity): AgentRecord {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    cardUrl: entity.cardUrl,
    source: entity.source,
    enabled: entity.enabled,
    displayName: entity.displayName ?? null,
    description: entity.description ?? null,
    protocolSnapshotVersion: entity.protocolSnapshotVersion ?? null,
    lastDiscoveryAt: entity.lastDiscoveryAt ?? null,
    lastHealthyAt: entity.lastHealthyAt ?? null,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

function agentCardSnapshotRecord(
  entity: AgentCardSnapshotEntity,
): AgentCardSnapshotRecord {
  return {
    id: entity.id,
    agentId: entity.agentId,
    fetchedAt: entity.fetchedAt,
    resolvedCardUrl: entity.resolvedCardUrl ?? null,
    rawCardJson: entity.rawCardJson,
    normalizedCardJson: entity.normalizedCardJson,
    complianceJson: entity.complianceJson,
    signatureStatus: entity.signatureStatus,
    digest: entity.digest,
  };
}

function taskRecord(entity: TaskEntity): TaskRecord {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    agentId: entity.agentId,
    tenant: entity.tenant,
    remoteTaskId: entity.remoteTaskId ?? null,
    remoteContextId: entity.remoteContextId ?? null,
    kind: entity.kind,
    state: entity.state,
    title: entity.title ?? null,
    ownerUserId: entity.ownerUserId ?? null,
    ownerTeamId: entity.ownerTeamId ?? null,
    createdAt: entity.createdAt,
    remoteCreatedAt: entity.remoteCreatedAt ?? null,
    updatedAt: entity.updatedAt,
    remoteUpdatedAt: entity.remoteUpdatedAt ?? null,
    terminalAt: entity.terminalAt ?? null,
    version: entity.version,
  };
}

function taskEventRecord(entity: TaskEventEntity): TaskEventRecord {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    agentId: entity.agentId,
    taskId: entity.taskId,
    source: entity.source,
    eventKind: entity.eventKind,
    receivedAt: entity.receivedAt,
    remoteTimestamp: entity.remoteTimestamp ?? null,
    sourceKey: entity.sourceKey,
    payloadDigest: entity.payloadDigest,
    payloadJson: entity.payloadJson,
    sessionId: entity.sessionId ?? null,
    requestId: entity.requestId ?? null,
    traceId: entity.traceId ?? null,
    projectionVersion: entity.projectionVersion,
  };
}

function outboxMessageRecord(entity: OutboxMessageEntity): OutboxMessageRecord {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    topic: entity.topic,
    aggregateType: entity.aggregateType,
    aggregateId: entity.aggregateId,
    payloadJson: entity.payloadJson,
    availableAt: entity.availableAt,
    attempts: entity.attempts,
    status: entity.status,
    leaseOwner: entity.leaseOwner ?? null,
    leaseUntil: entity.leaseUntil ?? null,
    lastError: entity.lastError ?? null,
    createdAt: entity.createdAt,
    processedAt: entity.processedAt ?? null,
  };
}

export class MikroOrmOrganizationRepository implements OrganizationRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async findById(id: string) {
    const entity = await this.entityManager.findOne(OrganizationEntity, { id });
    return entity ? organizationRecord(entity) : undefined;
  }

  async findBySlug(slug: string) {
    const entity = await this.entityManager.findOne(OrganizationEntity, {
      slug,
    });
    return entity ? organizationRecord(entity) : undefined;
  }

  async getOrCreate(organization: OrganizationRecord) {
    await this.entityManager.upsert(OrganizationEntity, organization, {
      disableIdentityMap: true,
      onConflictAction: "ignore",
      onConflictFields: ["slug"],
    });
    const entity = await this.entityManager.findOneOrFail(
      OrganizationEntity,
      { slug: organization.slug },
      { refresh: true },
    );
    return organizationRecord(entity);
  }
}

export class MikroOrmAgentRepository implements AgentRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async findById(organizationId: string, id: string) {
    const entity = await this.entityManager.findOne(AgentEntity, {
      id,
      organizationId,
    });
    return entity ? agentRecord(entity) : undefined;
  }

  async findByCardUrl(organizationId: string, cardUrl: string) {
    const entity = await this.entityManager.findOne(AgentEntity, {
      cardUrl,
      organizationId,
    });
    return entity ? agentRecord(entity) : undefined;
  }

  async insert(agent: AgentRecord) {
    const entity = this.entityManager.create(AgentEntity, agent);
    this.entityManager.persist(entity);
    await this.entityManager.flush();
    return agentRecord(entity);
  }

  async appendCardSnapshot(snapshot: AgentCardSnapshotRecord) {
    const entity = this.entityManager.create(AgentCardSnapshotEntity, snapshot);
    this.entityManager.persist(entity);
    await this.entityManager.flush();
    return agentCardSnapshotRecord(entity);
  }

  async findLatestCardSnapshot(agentId: string) {
    const entity = await this.entityManager.findOne(
      AgentCardSnapshotEntity,
      { agentId },
      { orderBy: { fetchedAt: "desc" } },
    );
    return entity ? agentCardSnapshotRecord(entity) : undefined;
  }
}

export class MikroOrmTaskRepository implements TaskRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async findById(organizationId: string, id: string) {
    const entity = await this.entityManager.findOne(TaskEntity, {
      id,
      organizationId,
    });
    return entity ? taskRecord(entity) : undefined;
  }

  async findByRemoteIdentity(identity: {
    organizationId: string;
    agentId: string;
    tenant: string;
    remoteTaskId: string;
  }) {
    const entity = await this.entityManager.findOne(TaskEntity, identity);
    return entity ? taskRecord(entity) : undefined;
  }

  async insert(task: TaskRecord) {
    const entity = this.entityManager.create(TaskEntity, task);
    this.entityManager.persist(entity);
    await this.entityManager.flush();
    return taskRecord(entity);
  }
}

export class MikroOrmTaskEventRepository implements TaskEventRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async appendIfAbsent(event: TaskEventRecord) {
    const sqlEntityManager = this.entityManager as SqlEntityManager;
    const result = await sqlEntityManager
      .createQueryBuilder(TaskEventEntity)
      .insert(event)
      .onConflict(["taskId", "source", "sourceKey"])
      .ignore()
      .execute<QueryResult>("run");
    return result.affectedRows > 0;
  }

  async findByTaskId(organizationId: string, taskId: string) {
    const entities = await this.entityManager.find(
      TaskEventEntity,
      { organizationId, taskId },
      { orderBy: { receivedAt: "asc" } },
    );
    return entities.map(taskEventRecord);
  }
}

export class MikroOrmOutboxRepository implements OutboxRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async enqueue(message: OutboxMessageRecord) {
    const entity = this.entityManager.create(OutboxMessageEntity, message);
    this.entityManager.persist(entity);
    await this.entityManager.flush();
    return outboxMessageRecord(entity);
  }

  async findById(organizationId: string, id: string) {
    const entity = await this.entityManager.findOne(OutboxMessageEntity, {
      id,
      organizationId,
    });
    return entity ? outboxMessageRecord(entity) : undefined;
  }
}

export function createPersistenceRepositories(entityManager: EntityManager) {
  return {
    organizations: new MikroOrmOrganizationRepository(entityManager),
    agents: new MikroOrmAgentRepository(entityManager),
    tasks: new MikroOrmTaskRepository(entityManager),
    taskEvents: new MikroOrmTaskEventRepository(entityManager),
    outbox: new MikroOrmOutboxRepository(entityManager),
  };
}
