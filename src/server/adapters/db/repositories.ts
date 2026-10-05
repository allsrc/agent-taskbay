import { taskAccessFilter } from "./security-repository";
import { replaceContentProjection, readContentProjection } from "./content-projections";
import { MikroOrmSyncCursorRepository } from "./sync-repository";
import { MikroOrmPushRepository } from "./push-repository";
import { LockMode, type EntityManager, type QueryResult } from "@mikro-orm/core";
import { randomUUID } from "node:crypto";
import { observationPaused } from "../../application/services/subscription-state";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/sql";

import type {
  AgentRepository,
  OrganizationRepository,
  OutboxRepository,
  TaskEventRepository,
  TaskRepository,
  TaskCommandRepository,
  SubscriptionRepository,
} from "../../application/ports/persistence";
import type {
  AgentCardSnapshotRecord,
  AgentRecord,
  OrganizationRecord,
  OutboxMessageRecord,
  TaskEventRecord,
  TaskRecord,
  TaskCommandRecord,
  SubscriptionRecord,
} from "../../domain/persistence-model";
import {
  AgentCardSnapshotEntity,
  AgentEntity,
  OrganizationEntity,
  OutboxMessageEntity,
  TaskEntity,
  TaskEventEntity,
  TaskCommandEntity,
  SubscriptionEntity,
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
    skillId: entity.skillId ?? null,
    projectionVersion: entity.projectionVersion,
    contentJson: entity.contentJson,
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
    sequence: entity.sequence,
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

  async listByOrganization(organizationId: string) {
    const entities = await this.entityManager.find(
      AgentEntity,
      { organizationId },
      { orderBy: { createdAt: "asc", id: "asc" }, refresh: true },
    );
    return entities.map(agentRecord);
  }

  async getOrCreate(agent: AgentRecord) {
    await this.entityManager.upsert(AgentEntity, agent, {
      disableIdentityMap: true,
      onConflictAction: "ignore",
      onConflictFields: ["organizationId", "cardUrl"],
    });
    const entity = await this.entityManager.findOneOrFail(
      AgentEntity,
      { organizationId: agent.organizationId, cardUrl: agent.cardUrl },
      { refresh: true },
    );
    return agentRecord(entity);
  }

  async updateRegistration(
    organizationId: string,
    id: string,
    registration: Pick<AgentRecord, "source" | "enabled" | "updatedAt">,
  ) {
    return (await this.entityManager.nativeUpdate(AgentEntity, { organizationId, id }, registration)) > 0;
  }

  async updateDiscovery(
    organizationId: string,
    id: string,
    discovery: Pick<AgentRecord, "displayName" | "description" | "protocolSnapshotVersion" | "lastDiscoveryAt" | "lastHealthyAt" | "updatedAt">,
  ) {
    return (await this.entityManager.nativeUpdate(AgentEntity, { organizationId, id }, discovery)) > 0;
  }

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

  async listContentPage(organizationId: string, limit: number, after?: string) {
    const entities = await this.entityManager.find(TaskEntity, {
      organizationId, $and: [await taskAccessFilter(this.entityManager)], ...(after ? { id: { $gt: after } } : {}),
    }, { orderBy: { id: "asc" }, limit });
    const records: TaskRecord[] = [];
    for (const entity of entities) records.push(await this.withContent(entity));
    return records;
  }

  private async withContent(entity: TaskEntity): Promise<TaskRecord> {
    const record = taskRecord(entity);
    if (entity.projectionVersion >= 2) {
      record.contentJson = await readContentProjection(this.entityManager, entity.organizationId, entity.id);
      if (!record.contentJson) throw new Error("Active task content projection missing.");
    }
    return record;
  }

  async getOrCreate(task: TaskRecord) {
    await this.entityManager.upsert(TaskEntity, task, {
      disableIdentityMap: true, onConflictAction: "ignore",
      onConflictFields: task.remoteTaskId === null ? ["id"] : ["agentId", "tenant", "remoteTaskId"],
    });
    const where = task.remoteTaskId === null ? { id: task.id, organizationId: task.organizationId } : {
      organizationId: task.organizationId, agentId: task.agentId, tenant: task.tenant, remoteTaskId: task.remoteTaskId,
    };
    const entity = await this.entityManager.findOneOrFail(TaskEntity, where, {
      lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true,
    });
    return this.withContent(entity);
  }

  async saveProjection(task: TaskRecord) {
    const entity = await this.entityManager.findOneOrFail(TaskEntity, {
      id: task.id, organizationId: task.organizationId,
    });
    if ((task.projectionVersion ?? 1) >= 2) await replaceContentProjection(this.entityManager, task);
    // Keep the legacy projection solely for explicit schema rollback.
    const { contentJson, ...columns } = task;
    this.entityManager.assign(entity, (task.projectionVersion ?? 1) >= 2 ? columns : { ...columns, contentJson });
    await this.entityManager.flush();
    return this.withContent(entity);
  }

  async listByOrganization(organizationId: string, limit: number, offset: number, filter = "all", restriction?: { include?: string[]; exclude?: string[] }) {
    const terminal = ["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"];
    const ids = [...(restriction?.include ? [{ id: { $in: restriction.include } }] : []), ...(restriction?.exclude?.length ? [{ id: { $nin: restriction.exclude } }] : [])];
    const state = filter === "active" || ["mine", "overdue", "unassigned"].includes(filter) ? { $nin: terminal } : filter === "needs-input" ? { $in: ["TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED"] } : filter === "done" ? { $in: terminal } : undefined;
    const entities = await this.entityManager.find(TaskEntity, { organizationId, $and: [await taskAccessFilter(this.entityManager), ...ids], kind: "task", ...(state ? { state } : {}) }, {
      orderBy: { updatedAt: "desc", id: "asc" }, limit, offset,
      fields: ["id", "organizationId", "agentId", "tenant", "remoteTaskId", "remoteContextId", "kind", "skillId", "state", "title", "createdAt", "updatedAt", "version"],
    });
    return entities.map((entity) => ({
      id: entity.id, organizationId: entity.organizationId, agentId: entity.agentId,
      tenant: entity.tenant, remoteTaskId: entity.remoteTaskId ?? null, remoteContextId: entity.remoteContextId ?? null,
      kind: entity.kind, skillId: entity.skillId ?? null, state: entity.state, title: entity.title ?? null,
      createdAt: entity.createdAt, updatedAt: entity.updatedAt, version: entity.version,
    }));
  }


  async findById(organizationId: string, id: string, includeContent = true) {
    const entity = await this.entityManager.findOne(TaskEntity, {
      id,
      organizationId, $and: [await taskAccessFilter(this.entityManager)],
    });
    return entity ? includeContent ? this.withContent(entity) : taskRecord(entity) : undefined;
  }

  async findByRemoteIdentity(identity: {
    organizationId: string;
    agentId: string;
    tenant: string;
    remoteTaskId: string;
  }) {
    const entity = await this.entityManager.findOne(TaskEntity, { ...identity, $and: [await taskAccessFilter(this.entityManager)] });
    return entity ? this.withContent(entity) : undefined;
  }

  async insert(task: TaskRecord) {
    const entity = this.entityManager.create(TaskEntity, task);
    this.entityManager.persist(entity);
    await this.entityManager.flush();
    return this.withContent(entity);
  }
}

export class MikroOrmTaskEventRepository implements TaskEventRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async readFeed(organizationId: string, taskId: string, after: number, limit: number) {
    const rows = await this.entityManager.find(TaskEventEntity, { organizationId, taskId, sequence: { $gt: after } },
      { orderBy: { sequence: "asc" }, limit });
    return rows.map(taskEventRecord);
  }

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
      { orderBy: { sequence: "asc" } },
    );
    return entities.map(taskEventRecord);
  }
}

export class MikroOrmOutboxRepository implements OutboxRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async claim(topic: string, owner: string, now: Date, leaseUntil: Date) {
    const entity = await this.entityManager.findOne(OutboxMessageEntity, {
      topic, $or: [{ status: "pending", availableAt: { $lte: now } }, { status: "processing", leaseUntil: { $lte: now } }],
    }, { orderBy: { availableAt: "asc", id: "asc" }, lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE, refresh: true });
    if (!entity) return undefined;
    const recovered = entity.status === "processing";
    this.entityManager.assign(entity, { status: "processing", leaseOwner: owner, leaseUntil, attempts: entity.attempts + 1 });
    await this.entityManager.flush();
    return { message: outboxMessageRecord(entity), recovered };
  }

  async renew(id: string, organizationId: string, owner: string, now: Date, until: Date) {
    return (await this.entityManager.nativeUpdate(OutboxMessageEntity,
      { id, organizationId, status: "processing", leaseOwner: owner, leaseUntil: { $gt: now } }, { leaseUntil: until })) === 1;
  }

  async finish(id: string, organizationId: string, owner: string, now: Date, changes: Pick<OutboxMessageRecord, "status" | "availableAt" | "lastError" | "processedAt">) {
    return (await this.entityManager.nativeUpdate(OutboxMessageEntity,
      { id, organizationId, status: "processing", leaseOwner: owner, leaseUntil: { $gt: now } },
      { ...changes, leaseOwner: null, leaseUntil: null })) === 1;
  }

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

export class MikroOrmTaskCommandRepository implements TaskCommandRepository {
  constructor(private readonly entityManager: EntityManager) {}
  async getOrCreate(input: TaskCommandRecord) {
    await this.entityManager.upsert(TaskCommandEntity, input, {
      onConflictFields: ["organizationId", "idempotencyKey"], onConflictAction: "ignore",
    });
    const entity = await this.entityManager.findOneOrFail(TaskCommandEntity,
      { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey }, { refresh: true });
    return { command: this.record(entity), created: entity.id === input.id };
  }
  async findById(organizationId: string, id: string) {
    const entity = await this.entityManager.findOne(TaskCommandEntity, { organizationId, id }, { refresh: true });
    return entity ? this.record(entity) : undefined;
  }
  async update(organizationId: string, id: string, changes: Pick<TaskCommandRecord, "status" | "resultJson" | "lastError" | "updatedAt">) {
    await this.entityManager.nativeUpdate(TaskCommandEntity, { organizationId, id }, changes);
  }
  private record(entity: TaskCommandEntity): TaskCommandRecord {
    return { skillId: entity.skillId ?? null, id: entity.id, organizationId: entity.organizationId, agentId: entity.agentId, tenant: entity.tenant,
      action: entity.action, idempotencyKey: entity.idempotencyKey, messageId: entity.messageId,
      payloadDigest: entity.payloadDigest, payloadObjectKey: entity.payloadObjectKey, status: entity.status,
      resultJson: entity.resultJson ?? null, lastError: entity.lastError ?? null, createdAt: entity.createdAt, updatedAt: entity.updatedAt };
  }
}

export class MikroOrmSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly entityManager: EntityManager) {}
  async sync(task: TaskRecord, now: Date) {
    if (task.kind !== "task" || !task.remoteTaskId) return;
    const paused = observationPaused(task.state);
    await this.entityManager.upsert(SubscriptionEntity, {
      id: randomUUID(), organizationId: task.organizationId, taskId: task.id, status: paused ? "stopped" : "pending",
      availableAt: now, attempts: 0, leaseOwner: null, leaseUntil: null, lastError: null, createdAt: now, updatedAt: now,
    }, { onConflictFields: ["taskId"], onConflictAction: "ignore", disableIdentityMap: true });
    if (paused) {
      await this.entityManager.nativeUpdate(SubscriptionEntity, { organizationId: task.organizationId, taskId: task.id },
        { status: "stopped", leaseOwner: null, leaseUntil: null, lastError: null, updatedAt: now });
    } else {
      // A reply re-arms a paused subscription without stealing an active lease.
      await this.entityManager.nativeUpdate(SubscriptionEntity, { organizationId: task.organizationId, taskId: task.id, status: "stopped" },
        { status: "pending", availableAt: now, attempts: 0, lastError: null, updatedAt: now });
    }
  }
  async findByTaskId(organizationId: string, taskId: string) {
    const entity = await this.entityManager.findOne(SubscriptionEntity, { organizationId, taskId }, { refresh: true });
    return entity ? this.record(entity) : undefined;
  }
  async claim(owner: string, now: Date, until: Date) {
    const entity = await this.entityManager.findOne(SubscriptionEntity, {
      $or: [{ status: "pending", availableAt: { $lte: now } }, { status: "streaming", leaseUntil: { $lte: now } }],
    }, { orderBy: { availableAt: "asc", id: "asc" }, lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE, refresh: true });
    if (!entity) return undefined;
    this.entityManager.assign(entity, { status: "streaming", leaseOwner: owner, leaseUntil: until, attempts: entity.attempts + 1, updatedAt: now });
    await this.entityManager.flush();
    return this.record(entity);
  }
  async renew(lease: SubscriptionRecord, now: Date, until: Date) {
    return (await this.entityManager.nativeUpdate(SubscriptionEntity,
      { id: lease.id, organizationId: lease.organizationId, status: "streaming", leaseOwner: lease.leaseOwner, leaseUntil: { $gt: now } },
      { leaseUntil: until, updatedAt: now })) === 1;
  }
  async finish(lease: SubscriptionRecord, now: Date, changes: Pick<SubscriptionRecord, "status" | "availableAt" | "lastError">) {
    return (await this.entityManager.nativeUpdate(SubscriptionEntity,
      { id: lease.id, organizationId: lease.organizationId, status: "streaming", leaseOwner: lease.leaseOwner, leaseUntil: { $gt: now } },
      { ...changes, leaseOwner: null, leaseUntil: null, updatedAt: now })) === 1;
  }
  private record(entity: SubscriptionEntity): SubscriptionRecord {
    return { id: entity.id, organizationId: entity.organizationId, taskId: entity.taskId, status: entity.status,
      availableAt: entity.availableAt, attempts: entity.attempts, leaseOwner: entity.leaseOwner ?? null, leaseUntil: entity.leaseUntil ?? null,
      lastError: entity.lastError ?? null, createdAt: entity.createdAt, updatedAt: entity.updatedAt };
  }
}

export function createPersistenceRepositories(entityManager: EntityManager) {
  return {
    organizations: new MikroOrmOrganizationRepository(entityManager),
    agents: new MikroOrmAgentRepository(entityManager),
    tasks: new MikroOrmTaskRepository(entityManager),
    taskEvents: new MikroOrmTaskEventRepository(entityManager),
    outbox: new MikroOrmOutboxRepository(entityManager),
    commands: new MikroOrmTaskCommandRepository(entityManager),
    subscriptions: new MikroOrmSubscriptionRepository(entityManager),
    push: new MikroOrmPushRepository(entityManager),
    syncCursors: new MikroOrmSyncCursorRepository(entityManager),
  };
}
