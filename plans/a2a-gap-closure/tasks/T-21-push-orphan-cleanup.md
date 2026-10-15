---
id: T-21
title: Clean up push configurations left behind on agents
phase: 4
status: done
depends_on: [T-01]
size: M
gap: G10
migration: no
updated: 2026-10-15
---

# T-21. Push configuration cleanup

## Goal

Remove push-notification configurations that Taskbay registered on agents and then lost track of (a crash between registering and recording, or a task that finished while Taskbay was down), so agents do not keep sending to dead registrations.

## What was found about signed push (D-17)

The SDK's `DefaultPushNotificationSender` does not sign JWTs and has no JWKS: it sends back the credential Taskbay registered (`Authorization: <scheme> <credentials>`, or `X-A2A-Notification-Token`). Taskbay's per-registration bearer token is therefore exactly what SDK agents support, and **signed-JWT verification is not part of this plan**. T-23 records it as roadmap work.

## Read first

- [DECISIONS.md D-17, D-16](../DECISIONS.md).
- `src/server/application/services/push-lifecycle.ts` (`PushLifecycleWorker`, `retireDisabled`, `adopt`), `ports/push.ts`, `adapters/a2a/push-gateway.ts` (`register`, `remove`), `adapters/db/push-repository.ts`, `runtime/push.ts`, `runtime/push-config.ts`.
- `src/lib/gateway.ts` (`listPushConfigs`), `docs/guides/agent-push-callbacks.md`.
- A2A v1.0 spec text on `ListTaskPushNotificationConfigs`: https://a2a-protocol.org/v1.0.1/specification/ . Step 0: confirm the response shape and pagination and write what you found in Notes for later.

## Scope

1. Gateway method `list(agent, task)` calling `listPushConfigs`; handle `PushNotificationNotSupportedError` and method-not-found as "nothing to clean".
2. A cleanup pass in `PushLifecycleWorker`, run at low frequency per `(agent)` using a lease like the other jobs (reuse a `sync_cursors`-style row or the registration rows; do not add a table unless unavoidable, and if you must, mark `migration: yes` first). For tasks that are terminal or whose registration is `deleted`, list configs and delete those that match **Taskbay's own pattern**: config id equals a registration id Taskbay issued, or the URL starts with `A2A_PUSH_CALLBACK_ORIGIN` + `/api/webhooks/a2a/`. Never touch other configs.
3. Safe with several workers and instances (lease), idempotent, bounded per pass (at most 50 tasks).
4. Visible: count of cleaned configs in the audit log as `push.cleanup` (counts only) and a line in the worker status output used by `docs/operations/running-and-workers.md`.
5. Off switch: none needed beyond push being disabled; cleanup runs only for agents with push registrations enabled.

## Acceptance criteria

1. With the scenario agent holding a stale config that matches the pattern for a terminal task, a pass deletes it; a config with a foreign URL is left alone.
2. Running twice is a no-op; two workers do not double-delete (db test with two contexts).
3. An agent without push support yields no error and no retries storm.
4. Works with embedded and separate workers.

## Tests

DB: extend `push.db.test.ts`. Unit: the matching rule table.

## Documentation

- `docs/guides/agent-push-callbacks.md`: Taskbay removes its own leftover configurations; what it never touches.
- `docs/operations/running-and-workers.md`, `docs/operations/troubleshooting.md`: the cleanup and how to see it.
- Audit events page: `push.cleanup`.
- `docs/reference/compatibility.md`: push row (list is now used for cleanup).
- `CHANGELOG.md`: Added.

## Out of scope

Signed notifications, user-configurable destinations, multiple configs per task.

## Notes for later

- Step 0 (spec v1.0.1 section 3.1.9, SDK `ListTaskPushNotificationConfigsResponse` in `@a2a-js/sdk`): request `{ tenant?, taskId, pageSize?, pageToken? }`; response `{ configs: TaskPushNotificationConfig[] (optional), nextPageToken: string (empty when no more) }`. Paginated. Errors: `PushNotificationNotSupportedError` when push is unsupported; a missing task is `TaskNotFoundError`. The gateway reads up to 5 pages of 100.
- Cleanup only looks at registrations in status `deleted` (last 30 days, at most one check per day). Terminal tasks that never had a registration row, or whose row is `failed`, are not checked.
- The audit entry carries the count in the action (`push.cleanup.<count>`) because audit rows have no data column; the per-agent "once per 5 minutes" claim is a row in `security_rate_buckets` (key `push-cleanup:<agentId>`), so no table was added.

## Implementation log

- 2026-10-15 · done: branch plan/T-21, tests: push-cleanup.db.test.ts, push-lifecycle.test.ts
Done on branch plan/T-21, no migration.

- Gateway: `A2APushGateway.list` (`adapters/a2a/push-gateway.ts`), unsupported / unknown task / method-not-found give an empty list.
- `PushLifecycleWorker.cleanupOne` and `isTaskbayPushConfig` (`services/push-lifecycle.ts`); repository methods `cleanupAgents`, `cleanupBatch`, `markChecked`, `claimCleanup`, `auditCleanup` (`adapters/db/push-repository.ts`, port `ports/push.ts`); loop wiring and the `Push cleanup removed N ...` status line in `workers/push-loop.ts` (runs when idle, at most once a minute per process; embedded and separate workers share this loop).
- Tests: `push-lifecycle.test.ts` (matching table), new `push-cleanup.db.test.ts` (added to `test:db`; own-id, own-URL and foreign configs, two organizations, rerun is a no-op, three racing workers, unsupported and unreachable agents; PostgreSQL variant runs when A2A_TEST_POSTGRES_URL is set, not run here).
- Docs: agent-push-callbacks, running-and-workers, troubleshooting, compatibility, data-model, threat-model, CHANGELOG.
- Hosting rules: 1 (state is in the database), 2 (database claim), 3 (org-scoped queries, two-org test), 4 (no schema change), 6 (PGlite run; PostgreSQL not run), 7 (the loop is shared with scripts/command-worker.ts), 8 (status line, audit, troubleshooting row; no separate off switch per the spec).
- Deviation: the audit action is `push.cleanup.<count>` rather than bare `push.cleanup`, to carry the count.
- Ran: lint, tsc, npm test, npm run test:db (PGlite), npm run build, verify-task-http (port 3141).
