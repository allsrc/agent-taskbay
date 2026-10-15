---
id: T-22
title: Load the agent's own task history on demand
phase: 4
status: done
depends_on: [T-01, T-04]
size: M
gap: G11
migration: no
updated: 2026-10-15
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

- `SdkReconciliationGateway.get` throws raw SDK errors; the new runtime maps them with `classifyRemoteError`. A later task could make that gateway throw `RemoteRejection` itself.
- The task page (`/tasks/[taskId]`) only marks history messages in its History card; the **Load agent history** button lives in chat only.

## Implementation log

- 2026-10-15 · done: branch plan/T-22; no migration; tests: versioned-task-projection (unit), agent-history (component), task-history.db (PGlite), verify-history-http
Done. No migration: provenance is derived from the ledger (a `historyRefresh: true` flag in the stored `projectionContext` of the `reconcile` ledger row), so a rebuild keeps it.

- Server: `src/server/runtime/task-history.ts` (`refreshTaskHistory`), route `src/app/api/tasks/[taskId]/history/refresh/route.ts`. `A2AReconciliationGateway.get` takes an optional `historyLength`. `ObserveTaskService` and `createTaskObserver` take `historyRefresh`. `reduceTaskLedger` labels messages `origin: "agent-history"` (only a row marked as a history load, only for messages no earlier row carried, never the status message). A later non-`reconcile` delivery of the same message clears the label; Taskbay's own re-reads do not set or clear it.
- UI: `src/components/chat/agent-history.tsx` (button, dividers, split), wired in `chat-view.tsx`. Errors use `CommandError`. The task page History card marks these messages.
- Tests: unit (`versioned-task-projection.test.ts`), component (`agent-history.test.tsx`), DB on both databases (`task-history.db.test.ts`, in `test:db`; two organizations, skill-scoped and no-access callers, rate limit, rebuild keeps labels), HTTP (`scripts/verify-history-http.mjs`, in `test:http`, against the scenario agent).
- Hosting rules: no process memory (the limiter is `takeRateLimit`, in the database; the read is one request-scoped call); organization scoping through `tasks.findById` and the access policy; no new table or column; works with embedded or separate workers because no worker is involved. Checked by the DB test on PGlite (PostgreSQL runs when `A2A_TEST_POSTGRES_URL` is set; not set here) and the HTTP script on PGlite.
- Deviations: errors use `409` with `error.kind` `task_not_found` when the agent forgot the task (the spec said only that it says so); a viewer or read-only grant gets `403`, a task the caller cannot see gets `404`.
