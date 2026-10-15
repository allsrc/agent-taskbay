---
id: T-25
title: Automatic discovery sweep (opt-in)
phase: 2
status: done
depends_on: [T-08, T-09]
size: L
gap: G5
migration: yes
updated: 2026-10-15
---

# T-25. Automatic discovery

## Goal

For agents an administrator sets to **Automatic**, a background sweep stores and follows tasks started elsewhere, within the limits in D-12 and the notification rules in D-13. This is opt-in; the default is Browse only (D-02).

## Read first

- [DECISIONS.md D-02, D-12, D-13, D-16](../DECISIONS.md) and the "Automatic sweep" diagram in [ARCHITECTURE.md](../ARCHITECTURE.md#automatic-sweep-mode-auto-opt-in).
- `application/services/reconcile-task.ts` (the list branch), `ports/reconciliation.ts`, `adapters/a2a/reconciliation-gateway.ts`, `runtime/reconciliation.ts`, `workers/reconciliation-loop.ts`, `adapters/db/sync-repository.ts`.
- T-08's services (`track-task.ts` shows the observe-as-discovered call to reuse).
- `scripts/command-worker.ts` (separate worker entry point).

## Scope

1. **Cursors.** `ensureDiscoveryCursors(agent)` creates (idempotent upsert) list cursors (`resource_key = ""`) for tenants `{""} ∪ {card supportedInterfaces[].tenant} ∪ {tenants of known tasks}`, only when the **effective** mode is `auto`. Call it after a successful discovery of such an agent, once per worker start for all `auto` agents, and when the mode changes to `auto`. Leaving `auto` (or lowering the cap) sets those cursors `stopped`; entering sets `pending` and clears `page_token`.
2. **List parameters.** Incremental sweeps use `statusTimestampAfter = lastSyncedAt − 5 min`, `pageSize = 100`, `historyLength = 20`, `includeArtifacts = true`. A full sweep (no timestamp) runs when `last_full_sweep_at` is null or older than 1 hour and sets it when the last page is consumed.
3. **Split the sweep.** In `ReconciliationWorker`'s list branch: known task → existing `ingest`; unknown → `sink.discover(cursor, event)`. Validate the whole page before ingesting any of it, as today. Invalid unknown tasks are skipped and counted.
4. **Service `discover-tasks.ts`.** For an unknown task: agent enabled; effective mode `auto`; no paused reason. History window: skip **terminal** tasks older than `task_discovery_history_days`; non-terminal always eligible. Caps (D-12): 500 new tasks in a first sweep, 200 otherwise, 5 000 per agent, then set `task_discovery_paused_reason`, audit `task.discovery.paused` and stop discovering. Observe as in T-08 but with `trackedByUserId = null`. Non-terminal tasks get subscription and push like any task. After the page, one audit row `task.discovery.found` `{ agentId, tenant, count }` when count > 0.
5. **Notifications** follow T-09 (D-13).
6. **Separate workers.** Add nothing new to the entry points beyond what already runs reconciliation; prove with a test that a separate worker process performs the sweep (the existing worker HTTP check pattern).
7. **Mode guard.** T-10 landed with a guard: `changeAgentSettings` in `src/server/runtime/agent-settings.ts` refuses `auto` with `409 not_available`, the UI hides the Automatic option (`AUTOMATIC_DISCOVERY_AVAILABLE = false` in `src/lib/browse-tasks.ts`), and the docs say it is "not available yet". Remove the guard, flip the constant, start cursors on the mode change (see scope 1), update `agent-settings.db.test.ts` (it asserts `not_available`), and update the docs that say "not available yet" (`connect-an-agent.md`, `http-api.md`).
8. **Leases.** Several workers or instances must never double-discover. The unique task identity plus the cursor lease already prevent it; add a concurrency test.

## Acceptance criteria

1. Agent in `auto` with the scenario agent seeded with 3 foreign tasks (working, input-required, completed 1 day ago) and one completed 30 days ago: after one sweep Taskbay has 3 discovered tasks with `trackedByUserId = null`; the old one is absent.
2. A second sweep with no changes adds nothing and writes no audit row.
3. Moving a seeded task to `input-required` is picked up and notifies once (T-09 rules).
4. Mode `browse` or `off`, or `A2A_TASK_DISCOVERY` lower than `auto`, stops the sweep; known tasks still reconcile; switching back to `auto` resumes without duplicates.
5. Caps behave as D-12 (with 700 seeded: 500 first, then up to 200 per sweep, pause at 5 000 with reason and audit row).
6. Hostile lists store nothing wrong and never throw out of the worker.
7. Non-terminal discovered tasks have subscription rows (and push when available).
8. Skill-scoped principals cannot see discovered tasks; whole-agent grantees can.
9. Multi-tenant agents are swept per tenant; tasks keep their tenant.
10. No-list agents end with cursor status `unsupported` and a visible status (T-10).
11. Two worker instances against one PostgreSQL database produce no duplicate tasks (db test with two contexts).

## Tests

- Unit: cap and window logic (`discover-tasks.test.ts`).
- DB: extend `discovery.db.test.ts` and `reconciliation.db.test.ts`.
- HTTP: covered in T-12.

## Documentation

- `docs/concepts/durable-tasks.md`: automatic discovery as an opt-in.
- `docs/guides/configuration-recipes.md`: "Let Taskbay find tasks automatically".
- `docs/reference/data-model.md`: sweep cursors and `last_full_sweep_at`.
- `docs/security/threat-model.md`: automatic mode stores what the credential can list; caps; who sees it.
- `docs/operations/running-and-workers.md`: the sweep and its status.
- Audit events page: `task.discovery.found`, `task.discovery.paused`.
- `CHANGELOG.md`: Added.

## Out of scope

Browse and track (T-08), the settings UI (T-10).

## Notes for later

## Implementation log

- 2026-10-15 · done: Migration0005_DiscoverySweepProgress (sync_cursors sweep_started_at/sweep_found/sweep_after; spec said no migration, the per-sweep caps and a filter that stays constant across pages need the state on the cursor so any worker can continue), DB_SCHEMA_VERSION=5. Application: discover-tasks.ts (planSweep: full on first/hourly, else lastSyncedAt minus 5 min; judgeDiscovered: history window, 500/200 per sweep, 5,000 per agent, tenant and shape), ReconciliationWorker list branch splits known (ingest) from unknown (discover) against ALL stored identities, keeps sweep progress on the cursor, DiscoveryPolicy injected, sink.discover/report/pause (lease-fenced; audit task.discovery.found/paused as system, with the agent as target; counts are not stored in the audit row). Runtime: discovery-cursors.ts (startAutomaticDiscovery per tenant of card and stored tasks; ensureAutomaticDiscoveryCursors at worker start; ensureDiscoveryCursorsFor after an agent card is recorded), changeAgentSettings starts cursors on entering auto (guard removed), AUTOMATIC_DISCOVERY_AVAILABLE=true, history-days input in the card. Tests: discover-tasks.test.ts, auto-discovery.db.test.ts (added to test:db: off/browse does nothing, auto stores within window, incremental asks only for changes, known tasks refresh, cap lowering stops it, two workers one cursor, hostile lists, unsupported, caps 500 then 200 then pause at 5,000, startup cursors), agent-settings test updated. Docs: connect-an-agent, durable-tasks, running-and-workers, configuration-recipes (recipe 9), data-model, threat-model, http-api, CHANGELOG. Not done: PostgreSQL profile; multi-tenant sweep per card tenant is covered by cursor creation but not by an end-to-end test against a tenant-declaring agent (T-12 can add).