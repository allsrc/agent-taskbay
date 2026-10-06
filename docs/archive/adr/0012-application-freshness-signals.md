# ADR 0012: Application SSE over committed projections

- Status: Accepted
- Date: 2026-10-03

## Decision

Projection writes enqueue `task.freshness` intent in the same transaction,
including rebuild activation and direct Message projections. Duplicate ingestion
does not enqueue another intent. A leased worker publishes committed intent
through a replaceable RealtimePublisher and then acknowledges the outbox row.
Failure or expired ownership retries with bounded backoff. Publishing twice is
safe: signals carry no task content and never dispatch remote work.

PGlite uses a process-global in-memory revision per organization, shared by the
embedded worker and HTTP routes. PostgreSQL uses an organization-keyed durable
revision token updated by the external worker and polled by web replicas.
Tokens are opaque equality markers, not ledger cursors or replay guarantees.
Concurrent publication cannot lose an invalidation; each write replaces the
token. The PostgreSQL token update commits before outbox acknowledgement.

GET /api/tasks/events resolves the server's development organization exactly
like task queries. It accepts no client organization selector. It emits `ready`
on every connection, `freshness` when the token changes, and periodic `resync`.
Connections are bounded and reconnect; abort and slow readers release resources.
The stream exposes no remote payloads, credentials, or task identifiers.

Tasks list/detail and known durable tasks in Chat re-query projections after
signals, reconnect, focus and periodic fallback. Signals received during a read
schedule a follow-up read. Browser consumers share one EventSource per tab and
coalesce bursts. Missed, duplicate or reordered signals affect only freshness;
the database remains authoritative. Browser persistence removal is the next
slice; existing compatibility diagnostic streams remain available.

## Consequences

- No live replay ledger, global sequence allocation or task content in SSE.
- Publication failure never rolls back an already committed projection.
- Database outages close streams safely; clients recover through reconnect/read.
- In-memory signals need no persistence across restart because `ready` re-queries.
- PostgreSQL polling reads one indexed token per organization/connection, not
  raw events. Shared polling/fan-out optimizations remain later scaling work.
- Plane A authentication and finer authorization remain Phase 3; the current
  HTTP adapter uses only the existing local organization boundary.

This extends ADRs 0002, 0007, 0008 and 0011 without changing remote observation,
task identity, command safety or projection rebuild semantics.
