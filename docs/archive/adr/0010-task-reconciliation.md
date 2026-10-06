# ADR 0010: Scoped task reconciliation with durable read cursors

- Status: Accepted
- Date: 2026-10-03

## Decision

Persist GetTask schedules per known local task and ListTasks pagination per
organization/agent/tenant scope. Ingestion creates intent in its transaction;
migration adopts existing nonterminal tasks, including input/auth-required.
Workers use fifteen-second leases with five-second heartbeats and fenced
checkpoints. GetTask runs every fifteen seconds; a completed list sweep runs
again after sixty seconds. ListTasks requests full history and artifacts and
performs full sweeps, avoiding a status timestamp watermark that could miss
artifact-only changes. Page tokens persist only after page ingestion succeeds.
A crash before checkpoint replays the same page through idempotent ingestion.
Unsupported ListTasks stops that cursor; GetTask remains the fallback, including
for v0.3 and peers without streaming. Transient errors retry with bounded delays;
a failed page resets pagination to recover expired tokens.

List reads update only already known tasks in the exact local scope. They do
not import unrelated remote work before production authorization exists. Unknown
initial-send outcomes remain uncertain: ListTasks cannot safely associate an
arbitrary task with a lost send. Reconciliation never sends user messages,
retries commands, or declares uncertain commands successful.

Every snapshot uses common event ingestion. Lock the task, recheck the version
captured before the remote read, validate task/context/optional tenant identity,
and renew the read lease inside that transaction. A concurrent update wins;
terminal tasks cannot be reopened by a delayed reconciliation response. Streams
and push keep their existing semantics. Projection rebuild and application SSE
remain subsequent slices.

The PGlite owner and PostgreSQL external task worker run the same reconciliation
loop under ADRs 0007/0008. Cursors store scheduling/operational metadata and
opaque pagination tokens, never credentials or raw remote error messages.

## Consequences

- Paused work can recover missed state changes with no browser present.
- Full sweeps trade extra read traffic for artifact convergence; scoped GetTask
  remains the authoritative fallback when pagination changes during a sweep.
- Untimestamped arbitrary stream/push replay and richer projection correction
  still require the following projection slice.
- Known-task polling stops on terminal state; retention and broader catalog
  synchronization remain outside this slice.
