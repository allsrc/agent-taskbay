---
id: T-08
title: Browse an agent's tasks and track one
phase: 2
status: done
depends_on: [T-07, T-01, T-03]
size: L
gap: G5
migration: no
updated: 2026-10-15
---

# T-08. Browse and track (backend)

## Goal

A person with the right access can list the tasks an agent has right now, without Taskbay storing anything, then choose to **track** one. A tracked task is stored and followed like any other, so it reaches Tasks, the Inbox and notifications, and can be answered, steered and cancelled.

## Read first

- [DECISIONS.md D-02, D-11, D-14, D-15, D-16](../DECISIONS.md) and the "Browse and track" diagram in [ARCHITECTURE.md](../ARCHITECTURE.md#browse-and-track-default-mode).
- `src/lib/gateway.ts` (`listTasks`, `getTask` params), `adapters/a2a/reconciliation-gateway.ts` (`list`, `get`, `ListTasksUnsupported`), `application/ports/reconciliation.ts`.
- `application/services/observe-task.ts`, `runtime/task-persistence.ts` (`createTaskObserver`, `manageSubscription`), `reconcile-task.ts` (`validateReconciledTask`), `subscription-state.ts`, `push-lifecycle.ts`, `adapters/db/push-repository.ts` (`adopt`).
- `src/server/runtime/security.ts` and `adapters/db/security-repository.ts` (`takeRateLimit`, `RateBucketEntity`), `runtime/identity.ts` (`authenticatedRoute`), `application/services/access-policy.ts`, `runtime/audit.ts`.
- Any route under `src/app/api/agents/[agentId]/` for the handler pattern.

## Scope

1. **Gateway.** Extend `list(...)` and the SDK call to accept `{ tenant, contextId?, status?, pageSize?, pageToken?, historyLength?, statusTimestampAfter? }`. Add a gateway method `getOne(agent, tenant, taskId)` if `get` is bound to a stored task.
2. **Service `browse-agent-tasks.ts`.** `browse(principal, agentId, query)` returns `{ rows, nextPageToken, listing: "supported" | "unsupported" }`. Order of checks: agent exists and is enabled for the organization; effective mode (T-07) is `browse` or `auto`; principal may **operate on the whole agent** (admin, or a grant with `skillId = null` and permission `operate`); rate limit; then `ListTasks` with `pageSize` (default 25, max 50). Each row is **display data only**: `{ taskId, contextId, state, updatedAt, title?, snippet?, tracked: boolean, localId? }`. `snippet` is the status message text truncated to 120 characters with control characters stripped; it is never HTML. `tracked` and `localId` come from one local lookup `(agent, tenant, remoteTaskId)`.
3. **Validation.** Drop and count rows that fail identity or shape checks (`status.state` valid, `id` string ≤ 255, tenant matches). A malformed page never fails the request unless nothing is valid; then return `502`-style error `AGENT_RESPONSE_INVALID`.
4. **Service `track-task.ts`.** `track(principal, agentId, { taskId, tenant })`:
   1. Same permission and mode checks as browse; rate limit.
   2. If a stored task with that identity exists, return its `localId` (idempotent) without re-reading.
   3. `GetTask` through the gateway. Map T-03 errors (`task_not_found` → `404 TASK_NOT_FOUND_ON_AGENT`).
   4. Validate identity, tenant, status shape, size. The browser's content is ignored (D-15).
   5. Observe with `origin = "discovered"`, `trackedByUserId = principal.userId`, `source = "reconcile"`, `skillId = null`, no `userMessage`, **no first-sight notification** (T-09 owns the rule; until it lands, skip `enqueueNotificationEvent` for tasks created in this call).
   6. Non-terminal tasks get a subscription row and push registration through the same paths as any task. Prove it in a test; if the observer's `onObserved` does not do this for a brand-new task, add it.
   7. Audit `task.discovery.tracked` with `{ agentId, tenant, taskId, localId }`.
5. **Routes.**
   - `GET /api/agents/:id/remote-tasks?tenant=&contextId=&status=&pageToken=` (role `operate`).
   - `POST /api/agents/:id/remote-tasks/track` body `{ taskId, tenant? }` (role `operate`), strict zod validation.
   - Map errors: `403` no whole-agent operate; `409 DISCOVERY_DISABLED` when the mode is `off` or the cap forbids; `429` rate limit with `Retry-After`; `501`-style `LISTING_UNSUPPORTED` when the agent has no `ListTasks`.
6. **Rate limit.** Use the database-backed limiter (key: user + agent): 30 browse calls and 20 tracks per minute. Works across instances (D-16).
7. **Stateless.** No cache, no in-memory pagination state. The page token is the agent's own `nextPageToken`, passed through after checking length ≤ 4096.
8. **Tracking never claims.** The task has no owner afterwards (D-14).

## Acceptance criteria

1. Against the scenario agent seeded with foreign tasks, browse returns them without creating any task, event, cursor or subscription row (assert row counts before and after).
2. Browse marks already-tracked tasks with `tracked: true` and their `localId`.
3. Track stores the task with `origin = discovered`, `trackedByUserId` set, the right state and history; calling it twice returns the same `localId` and one audit row for the first call.
4. A tracked non-terminal task has a subscription row, and a push registration when the agent advertises push and the callback origin is set; steering and cancelling it work through the normal commands.
5. A tracked terminal task has no subscription and is read-only history.
6. A skill-scoped principal gets `403` on browse and track and never sees the tracked task; a whole-agent operator can; a viewer gets `403`.
7. Mode `off` or cap `off` returns `409 DISCOVERY_DISABLED`; mode `browse` with cap `browse` works; the cap can lower but never raise an agent's mode.
8. An agent without `ListTasks` returns `LISTING_UNSUPPORTED`; Track by id still works if `GetTask` does.
9. A hostile listing (wrong tenant, missing status, 3 MB body) never creates data and returns sanitized rows or the error above.
10. Rate limit returns `429`; two instances sharing a database share the bucket (db test with two ORM contexts).
11. Tracking a task id the agent does not know returns `404 TASK_NOT_FOUND_ON_AGENT` and stores nothing.
12. Works on PGlite and PostgreSQL; with workers embedded and separate.

## Tests

- Unit: row sanitizing, snippet truncation, validation table.
- DB: new `discovery.db.test.ts` (**add to `test:db`**) for browse (no writes), track (writes, idempotency, subscription, push), permissions with two organizations, mode and cap, rate limit across contexts.
- HTTP: smoke case in `scripts/verify-task-http.mjs`; the full path is T-12.

## Documentation

- `docs/reference/http-api.md`: both routes, query and body, errors, roles.
- `docs/concepts/durable-tasks.md`: a fourth way a task becomes tracked (browse and track), and that browsing stores nothing.
- `docs/security/threat-model.md`: browsing exposes the agent credential's view of tasks to whole-agent operators; mitigations; nothing persisted; rate limit.
- `docs/reference/compatibility.md`: `ListTasks` now used for browsing; agents without it are unsupported for browsing but can still be tracked by id.
- Audit events page (`grep -rn "task.send.accepted" docs/`): `task.discovery.tracked`.
- `CHANGELOG.md`: Added.

## Out of scope

UI (T-10, T-26), automatic sweep (T-25), notification rules (T-09).

## Notes for later

## Implementation log

- 2026-10-15 · done: Backend for browse and track. ports/remote-tasks.ts (gateway + DiscoveryError), adapters/a2a/remote-task-gateway.ts, services/remote-task-rows.ts (display-only rows, snippet/title sanitising, GetTask validation), runtime/discovery.ts (browseRemoteTasks, trackRemoteTask: whole-agent operate, mode and cap, DB rate limits 30/20 per minute, audit task.discovery.tracked), routes GET /api/agents/:id/remote-tasks and POST .../track (strict body), ObserveTaskService/ObservationSession carry origin and trackedByUserId and suppress first-sight notifications for discovered tasks (T-09 refines), TaskRepository.findManyByRemoteIds, apiError sends Retry-After on 429. Fix found on the way: the SDK folds JSON-RPC -32700/-32600/-32601 into RequestMalformedError, so the classifier now reads envelopeCode first (DECISIONS D-03 updated). Tests: remote-task-rows.test.ts, remote-task-gateway.test.ts (scenario agent, open and protected), discovery.db.test.ts (added to test:db: no writes on browse, track stores/follows/audits, idempotent, permissions incl. skill-scoped/viewer/no grant, hostile gateway answers, off/cap, listing unsupported but track by id works, rate limit in DB), verify-task-http.mjs smoke (501, 404, 400s). Green: tsc, lint, npm test 415, test:db 24 files, build. Docs: http-api, data-model, durable-tasks, threat-model, compatibility, CHANGELOG. Not done: two-ORM-instance rate-limit proof (PGlite is single-process; the bucket is a DB row) and the PostgreSQL profile. Mixed-instance behavior relies on the existing takeRateLimit row lock.