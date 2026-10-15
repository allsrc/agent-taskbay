---
id: T-22
title: Load the agent's own task history on demand
phase: 4
status: todo
depends_on: [T-01, T-04]
size: M
gap: G11
migration: no
updated:
---

# T-22. On-demand remote history

## Goal

People can ask the agent for the history it keeps for a task, and the console labels it clearly as different from Taskbay's own record of what it received (WF-21).

## Read first

- [UI-DESIGN.md "Tasks list and task page"](../UI-DESIGN.md#tasks-list-and-task-page) (Agent history).
- `adapters/a2a/reconciliation-gateway.ts` (`get`), `reconcile-task.ts`, `runtime/reconciliation.ts` (`ingest`), `lib/gateway.ts` (`getTask` with `historyLength`), `versioned-task-projection.ts` (how `history` entries merge with the ledger).
- `src/app/tasks/[taskId]/page.tsx`, `components/chat/timeline.tsx`.

## Scope

1. `POST /api/tasks/:id/history/refresh` (role `operate` on the task's agent/skill): body `{ historyLength?: 1..200 }` default 50. Runs one `GetTask` with that length through the reconciliation gateway and ingests it with `source = "reconcile"` using the existing dedupe, so entries Taskbay already has are not duplicated. Rate limit: 6 per task per minute.
2. The projection marks messages that came **only** from agent history with `origin: "agent-history"` so the UI can place them in a labelled section; messages already received live keep their provenance.
3. UI: ghost button "Load agent history" in the timeline header (hidden for tasks without a remote id and for direct messages). After loading, divider labels "What Taskbay received" and "History the agent returned". A one-line note: "The agent chooses what history to keep. It may be incomplete."
4. Errors use T-04's component. `task_not_found` (agent forgot the task) says so.

## Acceptance criteria

1. With the scenario agent holding 10 history messages for a task Taskbay saw 3 of, loading returns 7 new entries labelled as agent history; loading again adds none.
2. Messages already received live are not relabelled.
3. A skill-scoped principal without access gets `404` like any task route.
4. Rebuilding projections preserves labels.
5. Rate limit returns `429` with `Retry-After`.

## Tests

- DB: ingestion and dedupe. Unit: projection labelling. Component: button and dividers.

## Documentation

- `docs/guides/use-the-console.md`: "Load agent history" and the two labels.
- `docs/concepts/durable-tasks.md`: Taskbay's ledger versus the agent's history.
- `docs/reference/http-api.md`, `docs/reference/data-model.md` (message provenance if stored).
- `CHANGELOG.md`: Added.

## Out of scope

Replacing the ledger with remote history. Retention.

## Notes for later

## Implementation log
