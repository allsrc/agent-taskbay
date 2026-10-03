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
terminalAt, version, projectionVersion, contentJson
```

Unique: `(agentId, tenant, remoteTaskId)` for real Tasks. Direct Message
threads use a separate locally generated identity and nullable `remoteTaskId`.
`version` supports optimistic projection updates. Slice 1.4 uses `contentJson`
as a transitional normalized detail projection; typed Task columns remain the
indexed list/filter path. Message/artifact tables and richer rebuild tooling
remain Phase 2 work (ADR 0006).

### TaskEvent

```text
id, organizationId, agentId, taskId,
source, eventKind, receivedAt, remoteTimestamp,
sourceKey, payloadDigest, payloadJson, sequence,
sessionId, requestId, traceId, projectionVersion
```

`source` is `stream`, `webhook`, `reconcile`, `command_response`, or `import`.
Events containing inline binary parts retain their complete original JSON in
ArtifactStore; `payloadJson` holds `{ event, originalEventObjectKey }`, where
`event` uses local binary download references. Non-binary events remain inline.
`payloadDigest` fingerprints the original canonical value (ADR 0006).

Slice 2.2 adds a database-generated sequence and `(taskId, sequence)` feed
index. Inserts allocate sequence values under the task ingestion lock; the
compatibility browser stream tails only committed, organization-scoped events.
Chat uses committed projection snapshots so historical ledger delivery does not
repeat visible transitions. Untimestamped task/status events use persisted
user-turn identity in addition to their fingerprint; command responses also
use stable command identity. Worker events persist safe
protocol/transport/negotiated-extension metadata
in the event envelope. This metadata never includes credentials or headers.

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

### TaskCommand (Slice 2.1)

```text
id, organizationId, agentId, tenant, action,
idempotencyKey, messageId, payloadDigest, payloadObjectKey,
status, resultJson, lastError, createdAt, updatedAt
```

Unique: `(organizationId, idempotencyKey)`. Reusing a key with different scoped
intent is a conflict. Input, including binary parts, lives in ArtifactStore;
the row contains its digest/object key. Outbox payloads contain the command ID.
Safe command responses reference externalized binary parts. Command status is
`pending`, `dispatching`, `succeeded`, `failed`, or `uncertain`.

Lease renewal and completion are fenced by owner and unexpired lease. Response
ingestion, command success, and outbox completion are one transaction. Known
pre-dispatch failures retry at most three times with stable message IDs;
expired attempts and uncertain remote results do not automatically resend
(ADR 0007). Command intent is distinct from the future workflow audit model.

### SubscriptionLease (Slice 2.2)

```text
id, organizationId, taskId, status, availableAt, attempts,
leaseOwner, leaseUntil, lastError, createdAt, updatedAt
```

Stored in `task_subscriptions`, unique by local `taskId`. Task ingestion and
subscription intent commit together. Active tasks use `pending`/`streaming`;
terminal and input/auth-required tasks use `stopped`. A command that returns
active state re-arms observation. Direct Messages have no subscription row.
Migration adopts existing active tasks.

Leases last 15 seconds and renew every 5 seconds, including quiet streams.
Each attempt uses a unique owner. Every worker event validates remote identity
and commits ingestion with an unexpired ownership fence. Expired leases may
reconnect safely because SubscribeToTask observes existing work without sending
new messages. Disconnects retry with 1–30 second exponential backoff. Graceful
shutdown aborts observation and releases intent; crash recovery waits for expiry.
The initial pool has eight streams per worker. See ADR 0008.

### WebhookRegistration (Slice 2.3)

```text
id, organizationId, taskId, status, desired, availableAt, attempts,
leaseOwner, leaseUntil, lastError, rateWindow, rateCount, createdAt, updatedAt
```

Stored in `task_push_registrations`, unique by local task ID. The registration
UUID is the remote config ID and callback path. No credential values are stored;
a server-only signing key derives single-purpose Bearer credentials (ADR 0009).
Push is opt-in. A configured worker adopts existing nonterminal tasks at startup,
and new intent commits with task ingestion. Direct Messages have no registration.

States are `pending`, `registering`, `active`, `deleting`, `deleted`, or `failed`.
Fifteen-second leases renew every five seconds, with fenced completion and safe
1–30 second retries. Interrupted creates recover by reading the same config ID.
Input/auth-required retains push; terminal state or agent disablement schedules
cleanup. An in-flight create cannot overwrite concurrent cleanup intent.
Authenticated callbacks have a persistent 120-per-minute rate window. Deleted
and disabled registrations reject callbacks; terminal tasks acknowledge late
valid deliveries without changing projections. Webhook event fingerprints are
registration scoped, with optional stable delivery IDs for repeated append bytes.

### SyncCursor (Slice 2.4)

```text
id, organizationId, agentId, tenant, resourceKey, taskId,
status, pageToken, availableAt, attempts, leaseOwner, leaseUntil,
lastError, lastSyncedAt, createdAt, updatedAt
```

Stored in `sync_cursors`, unique by organization/agent/tenant/resourceKey.
An empty resource key is a ListTasks scope; a local task UUID is a GetTask
schedule with a task foreign key. Ingestion creates intent transactionally;
migration adopts existing nonterminal work. Direct Messages never get cursors.
States are `pending`, `syncing`, `stopped`, and `unsupported`. Terminal tasks
stop their GetTask cursor; input/auth-required work remains polled.

Read leases last fifteen seconds and renew every five seconds. GetTask repeats
after fifteen seconds; complete list sweeps repeat after sixty seconds. Full
sweeps avoid missing artifacts with unchanged status timestamps. Page tokens
advance only after page ingestion; a crash replays the page. Failures reset the
page token and retry with bounded backoff, using safe operational errors.
Snapshots validate task/context/tenant identity, recheck the pre-read task
version under its ingestion lock, and renew the cursor lease in the same
transaction. Older remote timestamps and concurrent updates cannot regress
content/state. ListTasks only updates known scoped tasks. Unsupported listing
stops that cursor but preserves GetTask fallback. See ADR 0010.

### Content projections (Slice 2.5)

`Task.projectionVersion` selects the active projector. Version 1 uses legacy
`contentJson`; version 2 uses `task_projections` headers, ordered
`message_projections` and `artifact_projections`. All rows carry organization,
local task and projector version; UUIDs are deterministically derived from that
scope and content identity so repeated rebuilds preserve row identity. Message
and artifact uniqueness is `(taskId, projectionVersion, remote identity)`.
Headers contain task detail fields and transitions. Message/artifact rows contain
normalized parts and metadata, with binary digest, object key and size in local
part storage metadata. No inline binary is stored in these tables.

New events stamp projector version 2 and persist safe projection context (user
turn and source identity); older immutable rows are not rewritten. The reducer
uses ledger sequence, timestamp fences, scoped message identity and cross-source
occurrence deduplication. Full snapshots correct artifact assembly. Complete
original archives are validated and externalized again during rebuild; the
normalized projection is never replay's authority.

Rebuild captures a repeatable-read ledger snapshot, prepares content while the
old generation remains readable, then locks/fences the task version and replaces
rows/pointer atomically. A changed task forces retry; missing/corrupt/foreign
archives or an empty ledger refuse activation. Content readers use one SQL
snapshot for the active pointer/header/parts; list queries do not read the ledger.
Schema rollback exports the active view into legacy JSON before dropping tables.
See ADR 0011 for ambiguous untimestamped append policy and scaling limits.

### Application freshness (Slice 2.6)

Projection ingestion and rebuild activation enqueue `task.freshness` outbox
rows atomically, keyed by organization and local task aggregate, with an empty
payload. Duplicate ingestion enqueues nothing. Delivery uses fifteen-second
leases and safe retry state; expired ownership republishes without remote work.

`organization_freshness` stores `(organizationId primary key, token UUID)` for
the PostgreSQL polling adapter. A token is only an opaque equality marker.
Concurrent publications replace it atomically; readers may coalesce several
signals. PGlite uses a shared in-memory token instead. Signals contain no task
content or identifiers. Ready/resync/reconnect/fallback reads restore freshness
from scoped projections without requiring signal replay or a global sequence.
Rollback drops tokens and freshness intent while preserving tasks and events.
See ADR 0012.

### Browser reads (Slice 2.7)

The content-query port pages by local task UUID within the server-resolved
organization and includes both Tasks and direct Messages. It reads active
content projections, never protocol events. Responses expose the database task
version as an operational snapshot fence, separate from deterministic content.
A rebuild with unchanged task columns may retain its version; freshness still
re-queries the repaired content. No schema change is required for this slice.

Browser caches are disposable in-memory mirrors. Legacy persisted task content
and notification read keys are retired without importing them. Current alerts
are derived from durable task projections, while read marks are session-only
presentation state. Notification/recipient/read entities remain Phase 4 work.

## Later entities

### Phase 3 Slice 3.1 identity/session baseline

Implemented identities use local UUIDs and exact external identity mappings:

- `User`: `id, displayName, enabled, createdAt`.
- `ExternalIdentity`: `id, userId, issuer, subject`; unique `(issuer, subject)`.
  Email and provider role/organization claims are never identity or grants.
- `Membership`: `id, organizationId, userId, role, enabled`; unique
  `(organizationId, userId)`. Roles are initially admin/operator/viewer.
- `UserSession`: `tokenHash, membershipId, expiresAt, createdAt`. Only SHA-256
  of the random opaque cookie is stored. Current membership/user enabled state
  and role are resolved at every admitted request; sessions survive restart.
- `LoginAttempt`: `tokenHash, encryptedFlow, expiresAt`. This is transient,
  pre-membership global state: ten-minute login flows use `jose` authenticated
  JWE and a server-only key, and are atomically consumed once. No provider token
  is persisted. Expired attempts/sessions are cleaned on login.
- `SecurityAuditEvent`: `id, organizationId, actorUserId?, actorType, action,
  targetId, eventKey, createdAt`. The append-only port stores fixed safe facts.
  Provisioning has a system actor; command audit keys are unique and stable.
  Audit and accepted command/catalog intent commit atomically. Full workflow
  AuditEvent semantics/views remain Phase 4 work.

Users/identities are global mappings reachable through organization memberships;
sessions are reachable only through their membership. Browser identity/scope
headers and IdP claims cannot create memberships. Local development provisions
one local administrator; production memberships are operator provisioned.
Slice 3.2 adds `Team`, `TeamMembership` and `AccessGrant` with enabled organization,
membership/team subject, agent, optional skill and read/operate permission. Membership
roles remain the baseline ceiling. Task and command `skillId` are nullable typed columns;
null records require whole-agent access, and continuation cannot change skill scope.

The CredentialVault adapter owns `AgentCredential`: organization/agent-unique JWE
ciphertext, kind, key ID, enabled state, revision and update time. The authenticated
payload binds organization and agent. Domain task/event/outbox entities carry no
credential values or ciphertext. Keys are server environment configuration.

`ArtifactAccess` uniquely associates task and digest within the organization. Only
server-externalized inline bytes or digest-verified original archives may create these
rows; remote URL/metadata cannot grant access. Downloads join against currently visible
tasks. `SecurityRateBucket` has a fixed scope ID, count and expiry; locking increments
within a transaction and resets expired windows. All new tables/columns share the
PostgreSQL-compatible migration and adapter contract.

### Identity and access

- `Team`
- `Role`
- `RoleGrant`
- `AgentAccessGrant`
- `TaskAccessGrant` when exceptional sharing is required

### Agent connectivity

- `AgentInterface`
- `AgentSkill`
- `AgentCredentialBinding` containing only vault references and metadata
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
