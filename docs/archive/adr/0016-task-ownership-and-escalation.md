# ADR 0016: Task ownership, due times, escalation and internal notes

- Status: Accepted
- Date: 2026-10-05
- Requirements: HITL-005, SEC-004, AUD-001

## Context

Operators need to know who is responsible for an A2A task and by when, independently of
the remote task state, and to hand over, escalate and annotate work without touching the
agent. ADR 0015 covers approval requests; this covers the tasks themselves, including
input-required work.

## Decision

- Ownership is local state, never sent to the agent. A `TaskAssignment` row (one per task,
  created on first use) holds the assignee membership, claim time, due time, escalation
  level and the due time it last escalated for. The row is locked for every change.
- Rules: anyone with an operate grant may claim or assign unowned work; only the owner or
  an administrator may release, reassign or change the due time of owned work. The
  assignee must currently be an enabled operator or administrator with an operate grant
  for the task's agent/skill. Finished tasks cannot be claimed, assigned or given a due
  time; their history and notes remain. Task visibility and grants are the existing
  access policy: a member without a read grant sees a 404.
- Every ownership change appends an immutable `TaskAssignmentEvent` (kind, actor, from,
  to, due time) with timestamps that strictly increase per task, an audit fact, and a
  content-free freshness signal, all in the change's transaction. Repeating a change that
  is already true is a no-op that writes nothing.
- `TaskNote`s are internal, append-only and idempotent per client note key (a retry or
  concurrent submit returns the same note; a reused key for different content is a 409).
  Viewers can read but not write. Notes are never part of any agent message.
- An `EscalationPolicy` names the reviewer who receives overdue work, organization-wide or
  for one agent (the agent rule wins). Administrators manage policies. The worker sweep
  (same loop as ADR 0015) escalates unfinished owned tasks once per due time: it hands
  the task to the target, increments the level and records a system event. If the target
  can no longer operate the agent, the owner keeps the task and the event records that.
  Setting a new due time re-arms escalation. With no enabled policy nothing is changed;
  the task still shows as overdue.
- Queue views (mine, overdue, unassigned) are active-only filters over the same
  organization- and grant-scoped task query; list rows carry a small ownership summary.

## Consequences

- Approval requests keep their own assignee and `delegate` outcome (ADR 0015); they are
  not unified with task ownership in this slice.
- Teams cannot yet be escalation targets and escalation is a single hop per due time.
- Queue views load the matching assignment IDs and then page tasks; very large queues
  need the Phase 5 inbox projection.
- Escalation is visible in the UI and queue but there are no notifications yet.
- The history rows are the source for Phase 4's audit views.
