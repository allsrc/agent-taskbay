# ADR 0007: Durable commands, uncertain outcomes, and local dispatch

- Status: Accepted
- Date: 2026-10-03

## Decision

Persist a TaskCommand and command-dispatch outbox row atomically. Idempotency
keys are organization scoped; reusing a key with different intent returns a
conflict. The A2A message ID is assigned once and survives every attempt.
Command input is archived in ArtifactStore, including binary input; relational
rows contain its digest and object key. Outbox payloads contain only command IDs.

Dispatch uses bounded leases, renewals, and fenced completion. Response
ingestion, command success, and outbox completion commit together. Safe
pre-dispatch failures retry with bounded backoff. A failure after remote
dispatch may have produced a side effect: record an uncertain outcome and do
not automatically resend. Expired dispatch leases also become uncertain.
Stable message IDs alone do not prove that a remote agent deduplicates sends.
Reconciliation and explicit recovery policies belong to subsequent slices.

The local PGlite profile runs command dispatch in the Next.js Node process,
started at server initialization and sharing its single database owner. PGlite
does not support independent web/worker owners of the same data directory.
PostgreSQL supports a separate command worker entry point; deployments select
embedded or external dispatch explicitly. The application services and worker
loop are shared in both profiles.

This supersedes ADR 0004's requirement for separate local web/worker processes
only for the embedded PGlite profile. Separate worker deployment remains the
PostgreSQL target. Long-lived subscriptions remain browser-triggered until
Slice 2.2. Initial sends and cancellations use durable command dispatch.

## Consequences

- Accepted commands survive browser disconnect and web restart.
- Pending commands resume; an interrupted remote attempt is surfaced as
  uncertain instead of silently duplicating work.
- The local deployment requires a long-running Node server, not a serverless
  lifecycle. Production external workers use PostgreSQL and shared artifacts.
- Full workflow audit and actor authentication remain their existing phases;
  TaskCommand records preserve command intent without claiming approval audit.
