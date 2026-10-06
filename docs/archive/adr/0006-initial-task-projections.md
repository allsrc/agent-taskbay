# ADR 0006: Initial task projections and binary protocol archives

- Status: Accepted
- Date: 2026-10-03

## Context

Slice 1.4 needs durable task detail content before Phase 2 introduces full
message/artifact projection tables and worker ingestion. Replaying an entire
ledger on every UI read would make reads expensive. Inline protocol binary
parts must also survive restart without becoming relational blob storage.

## Decision

- Add a transitional Task.contentJson projection containing normalized history,
  transitions, and assembled artifact metadata/content references. The typed
  Task columns remain the indexed list/filter projection. List reads exclude
  contentJson and do not scan protocol events.
- Commit deduplicated TaskEvent rows and the content/state projection in one
  transaction under a task-row lock. Preserve optimistic task versions.
- Store inline binary parts in the ArtifactStore. For events containing binary,
  keep the complete original protocol JSON in a content-addressed object and
  store a TaskEvent envelope with the original object key and a JSON event
  whose binary parts are local download references. payloadDigest always
  fingerprints the original canonical protocol value.
- The filesystem adapter is the local implementation. Objects are organization
  scoped and immutable by digest; downloads are attachment-only octet streams.
  Production object storage, retention, content policy, and authorization
  adapters remain in their existing phases.
- Prefer source identity when available. The current SDK stream has no delivery
  IDs, so Slice 1.4 uses canonical payload fingerprints. Identical append chunks
  additionally use a per-payload occurrence and persisted user-turn identity
  to distinguish repeated bytes from reconnect replay. Missing remote message
  IDs receive stable event-derived projection IDs.
- A direct Message remains kind=message with a null remoteTaskId. Its supplied
  message ID maps to a stable, locally derived UUID scoped by agent and tenant;
  peers lacking message IDs use the local observation-session identity.
- All durable task URLs use local UUIDs. Contexts and browser cache entries
  carry agent and tenant scope; old chat context links resolve only when
  unambiguous.

## Consequences

- The existing browser-triggered stream is still a temporary writer. Phase 2
  moves task-lifetime streams and commands to workers; this ADR does not move
  that work into HTTP requests permanently.
- Phase 2 can rebuild or replace contentJson from retained original events and
  introduce richer versioned projections without changing task identity.
- File writes precede database commits. Failed transactions may leave immutable
  unreferenced objects; garbage collection belongs to retention/lifecycle work.
- A stream without delivery IDs, timestamps, or sequence numbers cannot fully
  disambiguate arbitrary partial replay across historical user turns. This
  fallback covers ordered reconnect replay within a turn and explicit new
  turns; broader convergence remains Phase 2 reconciliation work.
- Raw event archives and projections may contain sensitive task content.
  They follow the same future retention and access-policy boundaries as the
  existing TaskEvent ledger, and never include transport auth headers.

This extends ADRs 0002 and 0003 without superseding their durability and identity
contracts.
