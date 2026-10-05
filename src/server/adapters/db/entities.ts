import { defineEntity, p } from "@mikro-orm/core";

import type { AssignmentEventKind } from "../../domain/workflow-model";
import type { DecisionOutcome, DecisionPolicy, DecisionRequestStatus, DecisionRisk, ExecutionStatus, ProposedAction } from "../../domain/decision-model";
import type {
  JsonValue,
  OutboxStatus,
  TaskEventSource,
  CommandStatus,
  SubscriptionStatus,
  PushStatus,
} from "../../domain/persistence-model";

// Entity names must remain stable across independently minified Next.js chunks.
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
Object.defineProperty(OrganizationEntity, "name", { value: "OrganizationEntity" });
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
Object.defineProperty(AgentEntity, "name", { value: "AgentEntity" });
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
Object.defineProperty(AgentCardSnapshotEntity, "name", { value: "AgentCardSnapshotEntity" });
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
    projectionVersion: p.integer().default(1),
    contentJson: p.json<JsonValue>().defaultRaw("'{}'::jsonb"),
    skillId: p.string().length(255).nullable(),
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
Object.defineProperty(TaskEntity, "name", { value: "TaskEntity" });
TaskSchema.setClass(TaskEntity);

const TaskEventSchema = defineEntity({
  name: "TaskEventEntity",
  tableName: "task_events",
  properties: {
    sequence: p.integer().autoincrement(),
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
    { name: "idx_task_events_feed", properties: ["taskId", "sequence"] },
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
Object.defineProperty(TaskEventEntity, "name", { value: "TaskEventEntity" });
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
Object.defineProperty(OutboxMessageEntity, "name", { value: "OutboxMessageEntity" });
OutboxMessageSchema.setClass(OutboxMessageEntity);

const TaskCommandSchema = defineEntity({
  name: "TaskCommandEntity", tableName: "task_commands",
  properties: {
    id: p.uuid().primary(),
    organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"),
    agentId: () => p.manyToOne(AgentEntity).mapToPk().joinColumn("agent_id"),
    skillId: p.string().length(255).nullable(),
    tenant: p.string().length(255), action: p.string().length(32).$type<"send" | "cancelTask">(),
    idempotencyKey: p.string().length(255), messageId: p.string().length(255),
    payloadDigest: p.string().length(64), payloadObjectKey: p.text(),
    status: p.string().length(32).$type<CommandStatus>(), resultJson: p.json<JsonValue>().nullable(),
    lastError: p.text().nullable(), createdAt: p.datetime(), updatedAt: p.datetime(),
  },
  uniques: [{ name: "uq_task_commands_org_key", properties: ["organizationId", "idempotencyKey"] }],
  indexes: [{ name: "idx_task_commands_org_created", properties: ["organizationId", "createdAt"] }],
});
export class TaskCommandEntity extends TaskCommandSchema.class {}
Object.defineProperty(TaskCommandEntity, "name", { value: "TaskCommandEntity" });
TaskCommandSchema.setClass(TaskCommandEntity);

const SubscriptionSchema = defineEntity({
  name: "SubscriptionEntity", tableName: "task_subscriptions",
  properties: {
    id: p.uuid().primary(),
    organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"),
    taskId: () => p.manyToOne(TaskEntity).mapToPk().joinColumn("task_id").unique("uq_task_subscriptions_task"),
    status: p.string().length(32).$type<SubscriptionStatus>(),
    availableAt: p.datetime(), attempts: p.integer().default(0),
    leaseOwner: p.string().length(255).nullable(), leaseUntil: p.datetime().nullable(), lastError: p.text().nullable(),
    createdAt: p.datetime(), updatedAt: p.datetime(),
  },
  indexes: [{ name: "idx_task_subscriptions_ready", properties: ["status", "availableAt"] },
    { name: "idx_task_subscriptions_lease", properties: ["leaseUntil"] }],
});
export class SubscriptionEntity extends SubscriptionSchema.class {}
Object.defineProperty(SubscriptionEntity, "name", { value: "SubscriptionEntity" });
SubscriptionSchema.setClass(SubscriptionEntity);

const PushRegistrationSchema = defineEntity({
  name: "PushRegistrationEntity", tableName: "task_push_registrations",
  properties: {
    id: p.uuid().primary(),
    organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"),
    taskId: () => p.manyToOne(TaskEntity).mapToPk().joinColumn("task_id").unique("uq_task_push_registrations_task"),
    status: p.string().length(32).$type<PushStatus>(), desired: p.boolean(),
    availableAt: p.datetime(), attempts: p.integer().default(0),
    leaseOwner: p.string().length(255).nullable(), leaseUntil: p.datetime().nullable(), lastError: p.text().nullable(),
    rateWindow: p.datetime(), rateCount: p.integer().default(0), createdAt: p.datetime(), updatedAt: p.datetime(),
  },
  indexes: [{ name: "idx_task_push_registrations_ready", properties: ["status", "availableAt"] },
    { name: "idx_task_push_registrations_lease", properties: ["leaseUntil"] }],
});
export class PushRegistrationEntity extends PushRegistrationSchema.class {}
Object.defineProperty(PushRegistrationEntity, "name", { value: "PushRegistrationEntity" });
PushRegistrationSchema.setClass(PushRegistrationEntity);

const SyncCursorSchema = defineEntity({
  name: "SyncCursorEntity", tableName: "sync_cursors",
  properties: {
    id: p.uuid().primary(),
    organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"),
    agentId: () => p.manyToOne(AgentEntity).mapToPk().joinColumn("agent_id"),
    tenant: p.string().length(255), resourceKey: p.string().length(36),
    taskId: () => p.manyToOne(TaskEntity).mapToPk().joinColumn("task_id").nullable(),
    status: p.string().length(32).$type<import("../../domain/persistence-model").SyncCursorRecord["status"]>(),
    pageToken: p.text(), availableAt: p.datetime(), attempts: p.integer().default(0),
    leaseOwner: p.string().length(255).nullable(), leaseUntil: p.datetime().nullable(), lastError: p.text().nullable(),
    lastSyncedAt: p.datetime().nullable(), createdAt: p.datetime(), updatedAt: p.datetime(),
  },
  uniques: [{ name: "uq_sync_cursors_scope_resource", properties: ["organizationId", "agentId", "tenant", "resourceKey"] }],
  indexes: [{ name: "idx_sync_cursors_ready", properties: ["status", "availableAt"] },
    { name: "idx_sync_cursors_lease", properties: ["leaseUntil"] }],
});
export class SyncCursorEntity extends SyncCursorSchema.class {}
Object.defineProperty(SyncCursorEntity, "name", { value: "SyncCursorEntity" });
SyncCursorSchema.setClass(SyncCursorEntity);

const TaskProjectionSchema = defineEntity({
  name: "TaskProjectionEntity", tableName: "task_projections",
  properties: {
    id: p.uuid().primary(),
    organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"),
    taskId: () => p.manyToOne(TaskEntity).mapToPk().joinColumn("task_id"),
    projectionVersion: p.integer(),
    headerJson: p.json<JsonValue>(),
  },
  uniques: [{ name: "uq_task_projections_identity", properties: ["taskId", "projectionVersion"] }],
});
export class TaskProjectionEntity extends TaskProjectionSchema.class {}
Object.defineProperty(TaskProjectionEntity, "name", { value: "TaskProjectionEntity" });
TaskProjectionSchema.setClass(TaskProjectionEntity);

const MessageProjectionSchema = defineEntity({
  name: "MessageProjectionEntity", tableName: "message_projections",
  properties: {
    id: p.uuid().primary(),
    organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"),
    taskId: () => p.manyToOne(TaskEntity).mapToPk().joinColumn("task_id"),
    projectionVersion: p.integer(),
    remoteMessageId: p.text(), position: p.integer(), contentJson: p.json<JsonValue>(),
  },
  uniques: [{ name: "uq_message_projections_identity", properties: ["taskId", "projectionVersion", "remoteMessageId"] }],
});
export class MessageProjectionEntity extends MessageProjectionSchema.class {}
Object.defineProperty(MessageProjectionEntity, "name", { value: "MessageProjectionEntity" });
MessageProjectionSchema.setClass(MessageProjectionEntity);

const ArtifactProjectionSchema = defineEntity({
  name: "ArtifactProjectionEntity", tableName: "artifact_projections",
  properties: {
    id: p.uuid().primary(),
    organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"),
    taskId: () => p.manyToOne(TaskEntity).mapToPk().joinColumn("task_id"),
    projectionVersion: p.integer(),
    remoteArtifactId: p.text(), position: p.integer(), contentJson: p.json<JsonValue>(),
  },
  uniques: [{ name: "uq_artifact_projections_identity", properties: ["taskId", "projectionVersion", "remoteArtifactId"] }],
});
export class ArtifactProjectionEntity extends ArtifactProjectionSchema.class {}
Object.defineProperty(ArtifactProjectionEntity, "name", { value: "ArtifactProjectionEntity" });
ArtifactProjectionSchema.setClass(ArtifactProjectionEntity);

const OrganizationFreshnessSchema = defineEntity({
  name: "OrganizationFreshnessEntity", tableName: "organization_freshness",
  properties: {
    organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id").primary(),
    token: p.uuid(),
  },
});
export class OrganizationFreshnessEntity extends OrganizationFreshnessSchema.class {}
Object.defineProperty(OrganizationFreshnessEntity, "name", { value: "OrganizationFreshnessEntity" });
OrganizationFreshnessSchema.setClass(OrganizationFreshnessEntity);

const UserSchema = defineEntity({
  name: "UserEntity", tableName: "users",
  properties: { id: p.uuid().primary(), displayName: p.string().length(200), enabled: p.boolean(), createdAt: p.datetime() },
});
export class UserEntity extends UserSchema.class {}
Object.defineProperty(UserEntity, "name", { value: "UserEntity" });
UserSchema.setClass(UserEntity);

const ExternalIdentitySchema = defineEntity({
  name: "ExternalIdentityEntity", tableName: "external_identities",
  properties: { id: p.uuid().primary(), userId: () => p.manyToOne(UserEntity).mapToPk().joinColumn("user_id"),
    issuer: p.string().length(1024), subject: p.string().length(255) },
  uniques: [{ name: "uq_external_identity_issuer_subject", properties: ["issuer", "subject"] }],
});
export class ExternalIdentityEntity extends ExternalIdentitySchema.class {}
Object.defineProperty(ExternalIdentityEntity, "name", { value: "ExternalIdentityEntity" });
ExternalIdentitySchema.setClass(ExternalIdentityEntity);

const MembershipSchema = defineEntity({
  name: "MembershipEntity", tableName: "memberships",
  properties: { id: p.uuid().primary(), organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"),
    userId: () => p.manyToOne(UserEntity).mapToPk().joinColumn("user_id"), role: p.string().length(32), enabled: p.boolean() },
  uniques: [{ name: "uq_membership_org_user", properties: ["organizationId", "userId"] }],
});
export class MembershipEntity extends MembershipSchema.class {}
Object.defineProperty(MembershipEntity, "name", { value: "MembershipEntity" });
MembershipSchema.setClass(MembershipEntity);

const UserSessionSchema = defineEntity({
  name: "UserSessionEntity", tableName: "user_sessions",
  properties: { tokenHash: p.string().length(64).primary(),
    membershipId: () => p.manyToOne(MembershipEntity).mapToPk().joinColumn("membership_id"),
    expiresAt: p.datetime(), createdAt: p.datetime() },
  indexes: [{ name: "idx_user_sessions_expiry", properties: ["expiresAt"] }],
});
export class UserSessionEntity extends UserSessionSchema.class {}
Object.defineProperty(UserSessionEntity, "name", { value: "UserSessionEntity" });
UserSessionSchema.setClass(UserSessionEntity);

const LoginAttemptSchema = defineEntity({
  name: "LoginAttemptEntity", tableName: "login_attempts",
  properties: { tokenHash: p.string().length(64).primary(), encryptedFlow: p.text(), expiresAt: p.datetime() },
  indexes: [{ name: "idx_login_attempts_expiry", properties: ["expiresAt"] }],
});
export class LoginAttemptEntity extends LoginAttemptSchema.class {}
Object.defineProperty(LoginAttemptEntity, "name", { value: "LoginAttemptEntity" });
LoginAttemptSchema.setClass(LoginAttemptEntity);

const SecurityAuditSchema = defineEntity({
  name: "SecurityAuditEntity", tableName: "security_audit_events",
  properties: { id: p.uuid().primary(), organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"),
    actorUserId: () => p.manyToOne(UserEntity).mapToPk().joinColumn("actor_user_id").nullable().deleteRule("no action"),
    actorType: p.string().length(32),
    action: p.string().length(100), targetId: p.text(), eventKey: p.text().unique("uq_security_audit_event_key"), createdAt: p.datetime() },
  indexes: [{ name: "idx_security_audit_org_time", properties: ["organizationId", "createdAt"] }],
});
export class SecurityAuditEntity extends SecurityAuditSchema.class {}
Object.defineProperty(SecurityAuditEntity, "name", { value: "SecurityAuditEntity" });
SecurityAuditSchema.setClass(SecurityAuditEntity);

const TeamSchema = defineEntity({
  name: "TeamEntity", tableName: "teams",
  properties: { id: p.uuid().primary(), organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"), name: p.string().length(200), enabled: p.boolean() },
});
export class TeamEntity extends TeamSchema.class {}
Object.defineProperty(TeamEntity, "name", { value: "TeamEntity" });
TeamSchema.setClass(TeamEntity);

const TeamMembershipSchema = defineEntity({
  name: "TeamMembershipEntity", tableName: "team_memberships",
  properties: { id: p.uuid().primary(), teamId: () => p.manyToOne(TeamEntity).mapToPk().joinColumn("team_id"), membershipId: () => p.manyToOne(MembershipEntity).mapToPk().joinColumn("membership_id") }, uniques: [{ name: "uq_team_membership", properties: ["teamId", "membershipId"] }],
});
export class TeamMembershipEntity extends TeamMembershipSchema.class {}
Object.defineProperty(TeamMembershipEntity, "name", { value: "TeamMembershipEntity" });
TeamMembershipSchema.setClass(TeamMembershipEntity);

const AccessGrantSchema = defineEntity({
  name: "AccessGrantEntity", tableName: "access_grants",
  properties: { id: p.uuid().primary(), organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"), subjectType: p.string().length(32), subjectId: p.uuid(), agentId: () => p.manyToOne(AgentEntity).mapToPk().joinColumn("agent_id"), skillId: p.string().length(255).nullable(), permission: p.string().length(32), enabled: p.boolean() }, indexes: [{name: "idx_access_grant_subject", properties: ["organizationId", "subjectType", "subjectId"]}],
});
export class AccessGrantEntity extends AccessGrantSchema.class {}
Object.defineProperty(AccessGrantEntity, "name", { value: "AccessGrantEntity" });
AccessGrantSchema.setClass(AccessGrantEntity);

const AgentCredentialSchema = defineEntity({
  name: "AgentCredentialEntity", tableName: "agent_credentials",
  properties: { id: p.uuid().primary(), organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"), agentId: () => p.manyToOne(AgentEntity).mapToPk().joinColumn("agent_id"), kind: p.string().length(32), ciphertext: p.text(), keyId: p.string().length(64), enabled: p.boolean(), revision: p.integer().default(1).version(), updatedAt: p.datetime() }, uniques: [{ name: "uq_agent_credential_binding", properties: ["organizationId", "agentId"] }],
});
export class AgentCredentialEntity extends AgentCredentialSchema.class {}
Object.defineProperty(AgentCredentialEntity, "name", { value: "AgentCredentialEntity" });
AgentCredentialSchema.setClass(AgentCredentialEntity);

const RateBucketSchema = defineEntity({
  name: "RateBucketEntity", tableName: "security_rate_buckets",
  properties: { id: p.string().length(150).primary(), count: p.integer(), expiresAt: p.datetime() }, indexes: [{name: "idx_security_rate_expiry", properties: ["expiresAt"]}],
});
export class RateBucketEntity extends RateBucketSchema.class {}
Object.defineProperty(RateBucketEntity, "name", { value: "RateBucketEntity" });
RateBucketSchema.setClass(RateBucketEntity);

const ArtifactAccessSchema = defineEntity({
  name: "ArtifactAccessEntity", tableName: "artifact_access",
  properties: { id: p.uuid().primary(), organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"),
    taskId: () => p.manyToOne(TaskEntity).mapToPk().joinColumn("task_id"), digest: p.string().length(64) },
  uniques: [{name: "uq_artifact_access_task_digest", properties: ["taskId", "digest"]}],
  indexes: [{name: "idx_artifact_access_org_digest", properties: ["organizationId", "digest"]}],
});
export class ArtifactAccessEntity extends ArtifactAccessSchema.class {}
Object.defineProperty(ArtifactAccessEntity, "name", {value: "ArtifactAccessEntity"});
ArtifactAccessSchema.setClass(ArtifactAccessEntity);

const DecisionRequestSchema = defineEntity({
  name: "DecisionRequestEntity", tableName: "decision_requests",
  properties: {
    id: p.uuid().primary(),
    organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"),
    taskId: () => p.manyToOne(TaskEntity).mapToPk().joinColumn("task_id"),
    agentId: () => p.manyToOne(AgentEntity).mapToPk().joinColumn("agent_id"),
    tenant: p.string().length(255), skillId: p.string().length(255).nullable(),
    kind: p.string().length(64).$type<"send_message">(), status: p.string().length(32).$type<DecisionRequestStatus>(),
    requestKey: p.string().length(255), title: p.string().length(300), summary: p.text(),
    risk: p.string().length(16).$type<DecisionRisk>(), policyJson: p.json<DecisionPolicy>(),
    requesterUserId: p.uuid().nullable(), assignedMembershipId: p.uuid().nullable(),
    currentRevision: p.integer(), expiresAt: p.datetime(), createdAt: p.datetime(), updatedAt: p.datetime(),
    version: p.integer().default(1).version(),
  },
  uniques: [{ name: "uq_decision_requests_org_key", properties: ["organizationId", "requestKey"] }],
  indexes: [
    { name: "idx_decision_requests_org_status", properties: ["organizationId", "status", "expiresAt"] },
    { name: "idx_decision_requests_task", properties: ["taskId"] },
    { name: "idx_decision_requests_assignee", properties: ["organizationId", "assignedMembershipId", "status"] },
  ],
});
export class DecisionRequestEntity extends DecisionRequestSchema.class {}
Object.defineProperty(DecisionRequestEntity, "name", { value: "DecisionRequestEntity" });
DecisionRequestSchema.setClass(DecisionRequestEntity);

const DecisionRevisionSchema = defineEntity({
  name: "DecisionRevisionEntity", tableName: "decision_revisions",
  properties: {
    id: p.uuid().primary(),
    organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"),
    requestId: () => p.manyToOne(DecisionRequestEntity).mapToPk().joinColumn("request_id"),
    number: p.integer(), actionJson: p.json<ProposedAction>(), digest: p.string().length(64),
    authorType: p.string().length(16).$type<"agent" | "user" | "system">(), authorUserId: p.uuid().nullable(), createdAt: p.datetime(),
  },
  uniques: [{ name: "uq_decision_revisions_request_number", properties: ["requestId", "number"] }],
  triggers: [{ name: "trg_decision_revisions_immutable", timing: "before", events: ["update", "delete"], body: "raise exception 'decision records are immutable' using errcode = '23000';" }],
});
export class DecisionRevisionEntity extends DecisionRevisionSchema.class {}
Object.defineProperty(DecisionRevisionEntity, "name", { value: "DecisionRevisionEntity" });
DecisionRevisionSchema.setClass(DecisionRevisionEntity);

const DecisionSchema = defineEntity({
  name: "DecisionEntity", tableName: "decisions",
  properties: {
    id: p.uuid().primary(),
    organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"),
    requestId: () => p.manyToOne(DecisionRequestEntity).mapToPk().joinColumn("request_id"),
    revisionId: () => p.manyToOne(DecisionRevisionEntity).mapToPk().joinColumn("revision_id"),
    revisionDigest: p.string().length(64), outcome: p.string().length(32).$type<DecisionOutcome>(), rationale: p.text(),
    reviewerUserId: () => p.manyToOne(UserEntity).mapToPk().joinColumn("reviewer_user_id").deleteRule("no action"),
    reviewerMembershipId: p.uuid(), delegateMembershipId: p.uuid().nullable(),
    idempotencyKey: p.string().length(255), inputDigest: p.string().length(64), policyJson: p.json<DecisionPolicy>(), createdAt: p.datetime(),
  },
  uniques: [{ name: "uq_decisions_org_key", properties: ["organizationId", "idempotencyKey"] }],
  triggers: [{ name: "trg_decisions_immutable", timing: "before", events: ["update", "delete"], body: "raise exception 'decision records are immutable' using errcode = '23000';" }],
  indexes: [{ name: "idx_decisions_request", properties: ["requestId", "createdAt"] }],
});
export class DecisionEntity extends DecisionSchema.class {}
Object.defineProperty(DecisionEntity, "name", { value: "DecisionEntity" });
DecisionSchema.setClass(DecisionEntity);

const DecisionExecutionSchema = defineEntity({
  name: "DecisionExecutionEntity", tableName: "decision_executions",
  properties: {
    id: p.uuid().primary(),
    organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"),
    decisionId: () => p.manyToOne(DecisionEntity).mapToPk().joinColumn("decision_id"),
    revisionId: () => p.manyToOne(DecisionRevisionEntity).mapToPk().joinColumn("revision_id"),
    revisionDigest: p.string().length(64),
    commandId: () => p.manyToOne(TaskCommandEntity).mapToPk().joinColumn("command_id"),
    messageId: p.string().length(255), status: p.string().length(32).$type<ExecutionStatus>(),
    observedTaskState: p.string().length(64).nullable(), observedAt: p.datetime().nullable(),
    lastError: p.text().nullable(), createdAt: p.datetime(), updatedAt: p.datetime(),
  },
  uniques: [{ name: "uq_decision_executions_decision", properties: ["decisionId"] }, { name: "uq_decision_executions_command", properties: ["commandId"] }],
  triggers: [{ name: "trg_decision_executions_guard", timing: "before", events: ["update", "delete"],
    body: "if tg_op = 'DELETE' or new.decision_id <> old.decision_id or new.revision_id <> old.revision_id or new.revision_digest <> old.revision_digest or new.command_id <> old.command_id or new.message_id <> old.message_id or new.organization_id <> old.organization_id then raise exception 'decision execution correlation is immutable' using errcode = '23000'; end if; return new;" }],
});
export class DecisionExecutionEntity extends DecisionExecutionSchema.class {}
Object.defineProperty(DecisionExecutionEntity, "name", { value: "DecisionExecutionEntity" });
DecisionExecutionSchema.setClass(DecisionExecutionEntity);

const TaskAssignmentSchema = defineEntity({
  name: "TaskAssignmentEntity", tableName: "task_assignments",
  properties: {
    id: p.uuid().primary(),
    organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"),
    taskId: () => p.manyToOne(TaskEntity).mapToPk().joinColumn("task_id"),
    assigneeMembershipId: p.uuid().nullable(), claimedAt: p.datetime().nullable(), dueAt: p.datetime().nullable(),
    escalationLevel: p.integer().default(0), escalatedAt: p.datetime().nullable(), updatedAt: p.datetime(),
    version: p.integer().default(1).version(),
  },
  uniques: [{ name: "uq_task_assignments_task", properties: ["taskId"] }],
  indexes: [
    { name: "idx_task_assignments_assignee", properties: ["organizationId", "assigneeMembershipId"] },
    { name: "idx_task_assignments_due", properties: ["dueAt"] },
  ],
});
export class TaskAssignmentEntity extends TaskAssignmentSchema.class {}
Object.defineProperty(TaskAssignmentEntity, "name", { value: "TaskAssignmentEntity" });
TaskAssignmentSchema.setClass(TaskAssignmentEntity);

const TaskAssignmentEventSchema = defineEntity({
  name: "TaskAssignmentEventEntity", tableName: "task_assignment_events",
  properties: {
    id: p.uuid().primary(),
    organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"),
    taskId: () => p.manyToOne(TaskEntity).mapToPk().joinColumn("task_id"),
    kind: p.string().length(32).$type<AssignmentEventKind>(),
    actorUserId: () => p.manyToOne(UserEntity).mapToPk().joinColumn("actor_user_id").nullable().deleteRule("no action"),
    fromMembershipId: p.uuid().nullable(), toMembershipId: p.uuid().nullable(), dueAt: p.datetime().nullable(), createdAt: p.datetime(),
  },
  indexes: [{ name: "idx_task_assignment_events_task", properties: ["taskId", "createdAt"] }],
  triggers: [{ name: "trg_task_assignment_events_immutable", timing: "before", events: ["update", "delete"],
    body: "raise exception 'workflow history is immutable' using errcode = '23000';" }],
});
export class TaskAssignmentEventEntity extends TaskAssignmentEventSchema.class {}
Object.defineProperty(TaskAssignmentEventEntity, "name", { value: "TaskAssignmentEventEntity" });
TaskAssignmentEventSchema.setClass(TaskAssignmentEventEntity);

const TaskNoteSchema = defineEntity({
  name: "TaskNoteEntity", tableName: "task_notes",
  properties: {
    id: p.uuid().primary(),
    organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"),
    taskId: () => p.manyToOne(TaskEntity).mapToPk().joinColumn("task_id"),
    noteKey: p.string().length(255),
    authorUserId: () => p.manyToOne(UserEntity).mapToPk().joinColumn("author_user_id").deleteRule("no action"),
    body: p.text(), createdAt: p.datetime(),
  },
  uniques: [{ name: "uq_task_notes_org_key", properties: ["organizationId", "noteKey"] }],
  indexes: [{ name: "idx_task_notes_task", properties: ["taskId", "createdAt"] }],
  triggers: [{ name: "trg_task_notes_immutable", timing: "before", events: ["update", "delete"],
    body: "raise exception 'workflow history is immutable' using errcode = '23000';" }],
});
export class TaskNoteEntity extends TaskNoteSchema.class {}
Object.defineProperty(TaskNoteEntity, "name", { value: "TaskNoteEntity" });
TaskNoteSchema.setClass(TaskNoteEntity);

const EscalationPolicySchema = defineEntity({
  name: "EscalationPolicyEntity", tableName: "escalation_policies",
  properties: {
    id: p.uuid().primary(),
    organizationId: () => p.manyToOne(OrganizationEntity).mapToPk().joinColumn("organization_id"),
    agentId: () => p.manyToOne(AgentEntity).mapToPk().joinColumn("agent_id").nullable(),
    targetMembershipId: () => p.manyToOne(MembershipEntity).mapToPk().joinColumn("target_membership_id"),
    enabled: p.boolean(), createdAt: p.datetime(), updatedAt: p.datetime(),
  },
  indexes: [{ name: "idx_escalation_policies_scope", properties: ["organizationId", "agentId"] }],
});
export class EscalationPolicyEntity extends EscalationPolicySchema.class {}
Object.defineProperty(EscalationPolicyEntity, "name", { value: "EscalationPolicyEntity" });
EscalationPolicySchema.setClass(EscalationPolicyEntity);

export const persistenceEntities = [
  TaskAssignmentEntity, TaskAssignmentEventEntity, TaskNoteEntity, EscalationPolicyEntity,
  DecisionRequestEntity, DecisionRevisionEntity, DecisionEntity, DecisionExecutionEntity,
  ArtifactAccessEntity,
  TeamEntity, TeamMembershipEntity, AccessGrantEntity, AgentCredentialEntity, RateBucketEntity,
  UserEntity, ExternalIdentityEntity, MembershipEntity, UserSessionEntity, LoginAttemptEntity, SecurityAuditEntity,
  OrganizationFreshnessEntity,
  OrganizationEntity,
  AgentEntity,
  AgentCardSnapshotEntity,
  TaskEntity,
  TaskEventEntity,
  OutboxMessageEntity,
  TaskCommandEntity,
  SubscriptionEntity,
  PushRegistrationEntity,
  SyncCursorEntity,
  TaskProjectionEntity,
  MessageProjectionEntity,
  ArtifactProjectionEntity,
];
