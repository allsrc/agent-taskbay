# Persistent data model

## Goals

- Preserve A2A protocol fidelity while supporting organization-scoped inbox
  queries, ownership, approval, audit, and notifications.
- Run with PostgreSQL semantics in PGlite locally and PostgreSQL in production.
- Keep raw events replayable while serving UI reads from normalized projections.
- Prevent collisions between IDs issued by different agents or tenants.

## Identity rules

- Local primary keys are UUID strings generated before persistence.
- `organizationId` is the primary tenancy boundary.
- A remote task identity is `(agentId, tenant, remoteTaskId)`.
- A remote context identity is `(agentId, tenant, remoteContextId)`.
- A remote message identity is `(agentId, tenant, remoteMessageId)` when the
  peer supplied an ID.
- The application never uses a remote task ID as an unscoped URL/database key.
- Local workflow and task-link IDs are independent from A2A context and
  `referenceTaskIds`.

## Initial Phase 1 entities

### Organization

```text
id, slug, name, createdAt, updatedAt
```

Phase 1 creates a default local organization. Full membership and RBAC arrive
in Phase 3, but organization scoping exists from the first migration.

### Agent

```text
id, organizationId, cardUrl, source, enabled,
displayName, description, protocolSnapshotVersion,
lastDiscoveryAt, lastHealthyAt, createdAt, updatedAt
```

Unique: `(organizationId, cardUrl)`.

### AgentCardSnapshot

```text
id, agentId, fetchedAt, resolvedCardUrl, rawCardJson,
normalizedCardJson, complianceJson, signatureStatus, digest
```

Snapshots make card changes and trust decisions explainable.

### Task

```text
id, organizationId, agentId, tenant,
remoteTaskId, remoteContextId, kind, state,
title, ownerUserId, ownerTeamId,
createdAt, remoteCreatedAt, updatedAt, remoteUpdatedAt,
terminalAt, version
```

Unique: `(agentId, tenant, remoteTaskId)` for real Tasks. Direct Message
threads use a separate locally generated identity and nullable `remoteTaskId`.
`version` supports optimistic projection updates.

### TaskEvent

```text
id, organizationId, agentId, taskId,
source, eventKind, receivedAt, remoteTimestamp,
sourceKey, payloadDigest, payloadJson,
sessionId, requestId, traceId, projectionVersion
```

`source` is `stream`, `webhook`, `reconcile`, `command_response`, or `import`.
The preferred deduplication key is a stable protocol/source identifier. When
the peer supplies none, use a documented canonical payload digest plus task,
event kind, and relevant artifact/message identity. Database uniqueness is the
final guard against concurrent duplicate ingestion.

### OutboxMessage

```text
id, organizationId, topic, aggregateType, aggregateId,
payloadJson, availableAt, attempts, status,
leaseOwner, leaseUntil, lastError, createdAt, processedAt
```

Outbox rows are committed in the same transaction as the state that caused the
side effect. Workers claim rows with bounded leases.

## Later entities

### Identity and access

- `User`
- `ExternalIdentity`
- `Team`
- `Membership`
- `Role`
- `RoleGrant`
- `AgentAccessGrant`
- `TaskAccessGrant` when exceptional sharing is required

### Agent connectivity

- `AgentInterface`
- `AgentSkill`
- `AgentCredentialBinding` containing only vault references and metadata
- `WebhookRegistration`
- `SubscriptionLease`
- `SyncCursor`
- `AgentHealthSample`

### Task content and workflow

- `Conversation`
- `Message`
- `MessagePart`
- `Artifact`
- `ArtifactPart`
- `TaskTransition`
- `TaskLink` with `depends_on`, `produced_input_for`, `retry_of`,
  `spawned_from`, or `related_to`
- `TaskAssignment`
- `TaskNote`

### Human decisions

- `DecisionRequest`
- `Decision`
- `DecisionRevision` for edit-before-approve
- `DecisionExecution` correlating approved scope with observed execution
- `EscalationPolicy`

### Notifications and audit

- `Notification`
- `NotificationRecipient`
- `NotificationDelivery`
- `NotificationRead`
- `AuditEvent`
- `IdempotencyKey`
- `BackgroundFailure`

## Event ledger and projections

`TaskEvent` is an immutable protocol ledger, not the primary inbox query table.
Projectors update:

- `Task` current state and ownership;
- normalized messages and task transitions;
- assembled artifact metadata;
- pending intervention/decision projection;
- notification intents.

Projectors must be deterministic and versioned. A deployment may replay events
into a new projection version before switching reads.

Audit events are separate because “the agent reported COMPLETED” and “user X
approved action Y” have different trust and retention semantics.

## Artifacts

Relational artifact rows contain:

```text
id, taskId, remoteArtifactId, name, description,
mediaType, sizeBytes, sha256, objectKey, sourceUrl,
complete, createdAt, updatedAt, retentionClass
```

Binary data uses `ArtifactStore`. Inline A2A bytes may be streamed into the
store after size/policy validation. Remote URLs are preserved as provenance but
are not automatically trusted for direct browser loading.

## Portability rules

- Prefer UUID, text, integer, boolean, timestamp, and JSON values that map
  predictably to PostgreSQL/PGlite.
- Use text plus application validation for evolving protocol enums; do not let a
  newly introduced A2A state break an old database enum.
- Store timestamps in UTC and preserve a remote timestamp separately from
  receipt time.
- Keep filterable fields in typed columns; JSON is for raw protocol data and
  extension-specific payloads.
- Avoid database-specific queries in application services. Adapter-specific
  optimizations stay in repository implementations.
- SQLite support, if added, uses repository contract tests and explicit
  dialect migrations. PostgreSQL behavior remains canonical.

## Retention and sensitivity

- Credential values never appear in these entities; only vault references do.
- Raw wire/event payloads may contain sensitive content and require configurable
  retention and redaction.
- Audit records retain safe structured facts, not complete secrets or
  unbounded message bodies.
- Deleting user-visible transcript content must not destroy the minimal audit
  facts required to explain a decision.
