# ADR 0008: Durable worker subscriptions and committed browser event views

- Status: Accepted
- Date: 2026-10-03

## Decision

Persist one subscription intent per local Task in the ingestion transaction.
Adopt previously observed active tasks when migrating. Direct Messages never
receive subscription intent. Terminal, input-required, and auth-required states
stop observation; a new command returning active state re-arms it. This does
not interpret auth-required as business approval or login.

Workers claim bounded leases and renew quiet streams. Each attempt has a unique
owner identity. Every event must match the leased remote task and enter the
existing ingestion pipeline; projection/event writes and the lease fence commit
together. Losing a lease or canceling a task prevents a late observer from
committing. Expired subscriptions can safely reconnect using SubscribeToTask:
they observe existing work and never resend a message. Disconnects use bounded
exponential backoff. Peers without advertised streaming support stop with a
safe operational error.

Use the single PGlite owner embedded in the long-running Next.js Node server,
or the separate PostgreSQL worker, as decided in ADR 0007. Both entry points
run the same bounded subscription pool alongside command dispatch. Graceful
shutdown aborts streams and releases intent; crash recovery waits for expiry.

The compatibility browser stream reads committed projections and
organization-scoped protocol events with an indexed database-generated sequence
cursor. Chat updates use authoritative snapshots; protocol events remain available
for diagnostics without folding historical transitions into an existing cache. Sequence allocation
occurs under the task ingestion lock, so a reader cannot skip a later commit
for that task. Binary references and negotiated transport/extension metadata
are persisted before browser delivery. A browser disconnect only closes its
local view. A browser reconnect resolves an already-observed agent/tenant/task
identity and does not make an untracked remote call.

## Consequences

- Remote observation continues with zero connected browsers, including commands
  submitted through the 202 API and compatibility message entry points.
- The existing ordered replay/occurrence/user-turn artifact deduplication remains
  the Slice 2.2 fallback; arbitrary partial replay requires reconciliation.
- A send response with identical untimestamped content is scoped to its stable
  command identity, allowing a new reply to re-arm paused work. Untimestamped
  lifecycle events also use user-turn identity so the same prompt can pause a
  later turn while reconnect replays within a turn remain deduplicated.
- Streams are bounded by gateway timeouts and reconnect; the initial pool has
  eight concurrent streams per worker. More PostgreSQL workers add capacity.
- The compatibility event view is request-bounded. Application SSE freshness
  signals, webhook/push lifecycle, reconciliation and versioned projection
  rebuild remain separate Phase 2 slices.

This extends ADRs 0002, 0006 and 0007. It replaces ADR 0006's transitional
browser-owned writer with durable worker ingestion without changing identity,
artifact storage or deployment ownership boundaries.
