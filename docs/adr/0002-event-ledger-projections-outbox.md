# ADR 0002: Event ledger, projections, and transactional outbox

- Status: Accepted
- Date: 2026-10-01

## Context

A2A task state can arrive through a direct command response, a stream, a
resubscription, an at-least-once webhook, or a later reconciliation query.
Connections can fail between a remote side effect and the local response.
Browser-local state cannot resolve these failure modes.

## Decision

- Normalize every event source through one idempotent ingestion service.
- Append the validated raw protocol event before or atomically with projection
  updates.
- Serve inbox/task reads from normalized current-state projections.
- Persist side-effect intent in a transactional outbox committed with the state
  change that produced it.
- Give outbound commands stable local IDs and stable A2A `messageId` values.
- Make projectors versioned and rebuildable from retained events.

## Consequences

- Duplicate deliveries and reconnect replays are expected behavior.
- A unique deduplication key or canonical payload fingerprint is required.
- Raw event retention must be configurable because payloads may be sensitive.
- Workers need leases, retry policy, poison-message handling, and operational
  visibility.
- Live browser delivery becomes a cache-invalidation/freshness signal rather
  than the durable record.
