# ADR 0019: Unified inbox read model

- Status: Accepted
- Date: 2026-10-05
- Requirements: INB-001, INB-002, PERF-001, HITL-005, SEC-004

## Context

Tasks and approval requests each had their own list. Task views loaded assignment IDs before paging
(noted as unscalable in slice 4.2), approval lists were capped and unpaged, and neither shared a
cursor. Phase 5 needs one authorized queue across agents and teams.

## Decision

- The inbox is a read-only query over the existing typed, indexed columns of `tasks`,
  `task_assignments` and `decision_requests`. It adds no projection table: those columns already are
  the maintained projection, so there is nothing to keep in sync and nothing to rebuild.
- One `UNION ALL` of a task branch and an approval branch is ordered by `(updated_at, id)` descending
  and paged with a keyset cursor, so a page is exactly the rows after the cursor with no gaps or
  repeats. Each branch applies organization, agent/skill grants, view and filters inside SQL before
  `limit`. No event payload, content projection or JSON column is read.
- Access mirrors task and approval access: administrators see the whole organization; others see only
  rows for agents and skills they hold a read grant for; no grant yields an empty inbox. Names are
  display-only lookups on the returned page.
- Views are `all`, `active`, `needs-input`, `assigned`, `overdue` and `done`. Filters are kind, agent,
  skill, risk, status and updated-after. A risk or approval-only status excludes tasks.
- Migration `InboxIndex` adds `(organization_id, updated_at)` on `decision_requests` to match the
  existing task index.
- The Approvals queue is folded in: `/approvals` redirects to the inbox, and the approval review page
  and task page remain the detail views.

## Consequences

- Arbitrary-assignee, saved-view and text-search filters, SLA indicators and bulk actions are later
  Phase 5 slices on the same query.
- A very large organization may later need an index per hot filter; the query shape does not change.
