import { defineEntity, p } from "@mikro-orm/core";

import type {
  JsonValue,
  OutboxStatus,
  TaskEventSource,
} from "../../domain/persistence-model";

const OrganizationSchema = defineEntity({
  name: "OrganizationEntity",
  tableName: "organizations",
  properties: {
    id: p.uuid().primary(),
    slug: p.string().length(100).unique("uq_organizations_slug"),
    name: p.string().length(200),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});

export class OrganizationEntity extends OrganizationSchema.class {}
OrganizationSchema.setClass(OrganizationEntity);

const AgentSchema = defineEntity({
  name: "AgentEntity",
  tableName: "agents",
  properties: {
    id: p.uuid().primary(),
    organizationId: () =>
      p
        .manyToOne(OrganizationEntity)
        .mapToPk()
        .joinColumn("organization_id"),
    cardUrl: p.string().length(1024),
    source: p.string().length(32).$type<"env" | "managed">(),
    enabled: p.boolean(),
    displayName: p.string().length(300).nullable(),
    description: p.text().nullable(),
    protocolSnapshotVersion: p.string().length(100).nullable(),
    lastDiscoveryAt: p.datetime().nullable(),
    lastHealthyAt: p.datetime().nullable(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
  indexes: [
    { name: "idx_agents_organization", properties: ["organizationId"] },
  ],
  uniques: [
    {
      name: "uq_agents_organization_card_url",
      properties: ["organizationId", "cardUrl"],
    },
  ],
});

export class AgentEntity extends AgentSchema.class {}
AgentSchema.setClass(AgentEntity);

const AgentCardSnapshotSchema = defineEntity({
  name: "AgentCardSnapshotEntity",
  tableName: "agent_card_snapshots",
  properties: {
    id: p.uuid().primary(),
    agentId: () =>
      p.manyToOne(AgentEntity).mapToPk().joinColumn("agent_id"),
    fetchedAt: p.datetime(),
    resolvedCardUrl: p.string().length(1024).nullable(),
    rawCardJson: p.json<JsonValue>(),
    normalizedCardJson: p.json<JsonValue>(),
    complianceJson: p.json<JsonValue>(),
    signatureStatus: p.string().length(64),
    digest: p.string().length(64),
  },
  indexes: [
    {
      name: "idx_agent_card_snapshots_agent_fetched",
      properties: ["agentId", "fetchedAt"],
    },
  ],
});

export class AgentCardSnapshotEntity extends AgentCardSnapshotSchema.class {}
AgentCardSnapshotSchema.setClass(AgentCardSnapshotEntity);

const TaskSchema = defineEntity({
  name: "TaskEntity",
  tableName: "tasks",
  properties: {
    id: p.uuid().primary(),
    organizationId: () =>
      p
        .manyToOne(OrganizationEntity)
        .mapToPk()
        .joinColumn("organization_id"),
    agentId: () =>
      p.manyToOne(AgentEntity).mapToPk().joinColumn("agent_id"),
    tenant: p.string().length(255),
    remoteTaskId: p.string().length(512).nullable(),
    remoteContextId: p.string().length(512).nullable(),
    kind: p.string().length(64),
    state: p.string().length(64),
    title: p.string().length(500).nullable(),
    contentJson: p.json<JsonValue>().defaultRaw("'{}'::jsonb"),
    ownerUserId: p.uuid().nullable(),
    ownerTeamId: p.uuid().nullable(),
    createdAt: p.datetime(),
    remoteCreatedAt: p.datetime().nullable(),
    updatedAt: p.datetime(),
    remoteUpdatedAt: p.datetime().nullable(),
    terminalAt: p.datetime().nullable(),
    version: p.integer().default(1).version(),
  },
  indexes: [
    {
      name: "idx_tasks_organization_updated",
      properties: ["organizationId", "updatedAt"],
    },
    {
      name: "idx_tasks_organization_state",
      properties: ["organizationId", "state"],
    },
  ],
  uniques: [
    {
      name: "uq_tasks_remote_identity",
      properties: ["agentId", "tenant", "remoteTaskId"],
    },
  ],
});

export class TaskEntity extends TaskSchema.class {}
TaskSchema.setClass(TaskEntity);

const TaskEventSchema = defineEntity({
  name: "TaskEventEntity",
  tableName: "task_events",
  properties: {
    id: p.uuid().primary(),
    organizationId: () =>
      p
        .manyToOne(OrganizationEntity)
        .mapToPk()
        .joinColumn("organization_id"),
    agentId: () =>
      p.manyToOne(AgentEntity).mapToPk().joinColumn("agent_id"),
    taskId: () =>
      p.manyToOne(TaskEntity).mapToPk().joinColumn("task_id"),
    source: p.string().length(32).$type<TaskEventSource>(),
    eventKind: p.string().length(100),
    receivedAt: p.datetime(),
    remoteTimestamp: p.datetime().nullable(),
    sourceKey: p.string().length(512),
    payloadDigest: p.string().length(64),
    payloadJson: p.json<JsonValue>(),
    sessionId: p.string().length(255).nullable(),
    requestId: p.string().length(255).nullable(),
    traceId: p.string().length(255).nullable(),
    projectionVersion: p.integer(),
  },
  indexes: [
    {
      name: "idx_task_events_task_received",
      properties: ["taskId", "receivedAt"],
    },
    {
      name: "idx_task_events_organization_received",
      properties: ["organizationId", "receivedAt"],
    },
  ],
  uniques: [
    {
      name: "uq_task_events_source_key",
      properties: ["taskId", "source", "sourceKey"],
    },
  ],
});

export class TaskEventEntity extends TaskEventSchema.class {}
TaskEventSchema.setClass(TaskEventEntity);

const OutboxMessageSchema = defineEntity({
  name: "OutboxMessageEntity",
  tableName: "outbox_messages",
  properties: {
    id: p.uuid().primary(),
    organizationId: () =>
      p
        .manyToOne(OrganizationEntity)
        .mapToPk()
        .joinColumn("organization_id"),
    topic: p.string().length(255),
    aggregateType: p.string().length(100),
    aggregateId: p.uuid(),
    payloadJson: p.json<JsonValue>(),
    availableAt: p.datetime(),
    attempts: p.integer().default(0),
    status: p.string().length(32).$type<OutboxStatus>(),
    leaseOwner: p.string().length(255).nullable(),
    leaseUntil: p.datetime().nullable(),
    lastError: p.text().nullable(),
    createdAt: p.datetime(),
    processedAt: p.datetime().nullable(),
  },
  indexes: [
    {
      name: "idx_outbox_messages_ready",
      properties: ["status", "availableAt"],
    },
    {
      name: "idx_outbox_messages_lease",
      properties: ["leaseUntil"],
    },
    {
      name: "idx_outbox_messages_aggregate",
      properties: ["aggregateType", "aggregateId"],
    },
  ],
});

export class OutboxMessageEntity extends OutboxMessageSchema.class {}
OutboxMessageSchema.setClass(OutboxMessageEntity);

export const persistenceEntities = [
  OrganizationEntity,
  AgentEntity,
  AgentCardSnapshotEntity,
  TaskEntity,
  TaskEventEntity,
  OutboxMessageEntity,
];
