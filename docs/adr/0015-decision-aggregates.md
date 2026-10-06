# ADR 0015: Typed decision aggregates and exact-revision execution

- Status: Accepted
- Date: 2026-10-05
- Requirements: HITL-003, HITL-004, SEC-004, AUD-001, AUD-002

## Context

ADR 0005 separates business approval from login and from the in-task
`INPUT_REQUIRED`/`AUTH_REQUIRED` protocol states. Approval must be provable from
the console's own records: who approved which exact content, under which policy,
and what then happened.

## Decision

- A `DecisionRequest` is scoped to one local A2A task. Agent, tenant, skill and
  task come from the task row and are never accepted from the proposed content.
  Direct Messages and finished tasks cannot have requests. Opening is idempotent
  on `(organization, requestKey)`; reusing a key for different content is a 409.
- Proposed content is a typed, immutable `DecisionRevision` (initially one
  `send_message` action). Its digest is the canonical SHA-256 of the action. A new
  revision, from the proposer or from a reviewer's `edit`, never mutates an old one.
- A `Decision` is an immutable row recording outcome, rationale, reviewer user and
  membership, the exact revision ID and digest, an input digest, and a snapshot of
  the policy. Outcomes: `approve`, `reject`, `edit` (new revision + approval of it),
  `request_changes`, and `delegate` (reassigns, does not close the request).
- The reviewer states the revision they saw (`expectedRevision`); a newer revision
  fails with 409, so approval can never apply to content the reviewer did not read.
- Authority is the console's own, independent of the Agent Card: reviewers need the
  operator role plus an `operate` grant for the agent/skill, a read grant to even see
  the request (otherwise 404), the request's assignee (admins excepted), and, by
  default, must not be the requester (`separationOfDuties`).
- Requests expire (maximum 30 days). Expiry is checked on every decision and swept
  by `expireDue`; the expired state is committed and then reported as a refusal. A
  newer request for the same task supersedes older open ones, and a decision attempt
  against a task that has already ended supersedes the request instead of executing. Expired, superseded, rejected and approved requests
  cannot authorize anything.
- Approval and execution are one transaction: the decision, the `DecisionExecution`
  and the ordinary `TaskCommand` + outbox row (idempotency key `decision:<decisionId>`,
  message ID `decision-<decisionId>`) commit together, so a replayed key or a lost
  race cannot dispatch twice. The command is accepted through the same scope and
  skill-routing checks as any operator send and carries exactly the approved
  revision's content. Dispatch retry and uncertain-outcome behavior are inherited
  from ADR 0007; nothing resends an uncertain command.
- `DecisionExecution` stores the approved revision ID/digest, command ID and message
  ID, and reads through to the command status and the observed task state. The
  observed outcome is refreshed on read; it never alters the decision.
- Immutability is enforced in the database: updates and deletes of decisions and
  revisions are rejected by triggers, as are changes to an execution's correlation
  columns. Only the observed-outcome fields of an execution may change.
- Every transition writes a `SecurityAudit` fact (`decision.requested`,
  `decision.approve`, `decision.expired`, ...) in the same transaction with a
  deterministic event key. The decision rows themselves carry the full detail, so
  audit and aggregate remain distinct from A2A protocol events (AUD-002).

## Addendum: worker enforcement and live signals (slice 4.3)

- A worker pass (`DecisionService.sweep`, every `A2A_DECISION_SWEEP_MS`, embedded and
  external workers) expires overdue requests, supersedes open requests whose task has
  finished, and refreshes deliveries until the task outcome is final. Each change
  re-checks state under the request row lock, so several workers (or a reviewer acting at
  the same moment) close a request exactly once. The sweep holds no principal and
  dispatches nothing.
- Every state change, including a worker's, queues the existing content-free
  `task.freshness` outbox signal in its own transaction; no-op passes publish nothing.
  Open approval pages re-query on the signal and keep the five-second poll as the fallback
  for missed signals, as the Tasks views do.
- A delivery is watched for seven days after approval, then left as last observed.

## Addendum: structured actions and approval identity (Phase 6 slice 6.5)

Prompted by research on how other A2A frameworks handle approvals (A2A spec §7.6.4: an interrupted state is a
coordination signal, not an authorization grant; the implementation or extension must define the authorized operation and
check it at use; published "loopjacking" attacks substituted the operation under an approval bound only to a task id).
This ADR already binds approval to an exact digest, consumed once; the addendum extends that to structured content.

- A second typed action, `send_data`, carries `form` (an ADR 0020 form definition, pinned) and `values`. The
  domain service validates the form against the supported subset and the values against the form, rejects undeclared keys,
  and stores the coerced submission, so what is stored, digested, reviewed and sent are the same declared keys and types.
- The digest covers `{kind, form, values}`. A reviewer's `edit` may change values but never the form (422), and neither
  an edit nor a revision may change the kind of action (422). Scope still comes from the request, never from the action.
- Execution sends exactly one `application/json` data part with the approved values, never flattened text (another
  framework's flattening of a structured answer stopped the remote agent from resuming).
- Every approved message, of either kind, carries `metadata.approval = {requestId, decisionId, revision, revisionDigest}`,
  so a cooperating agent can verify what it was approved to do and echo it. The console proves what was approved and
  sent, not what the agent then executes; the echo contract is tracked as an issue.
- The `kind` column already holds free text, so there is no migration. Existing `send_message` approvals are unchanged
  apart from the added metadata.
- Not decided here: agents opening requests themselves, and blocking plain replies that would bypass an open request
  (both tracked as issues and covered by later ADRs).

## Consequences

- Phase 4 assignment, escalation, notes, notification channels and audit views build
  on `assignedMembershipId`, `expiresAt` and the audit facts without changing this
  model. `delegate` is the only assignment action in this slice.
- Typed actions are `send_message` and, since the Phase 6 addendum, `send_data`. New action kinds need
  a new discriminated variant, a renderer and an execution adapter.
- Agents cannot yet open requests themselves; operators open them on an agent's
  behalf. A reviewed agent extension would be a separate decision.
- Triggers are part of the PostgreSQL schema declared on the entities, so
  `db:schema:check` guards them. SQLite/libSQL adapters would need an equivalent.
