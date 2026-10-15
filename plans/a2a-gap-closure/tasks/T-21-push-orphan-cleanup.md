---
id: T-21
title: Clean up push configurations left behind on agents
phase: 4
status: todo
depends_on: [T-01]
size: M
gap: G10
migration: no
updated:
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

## Implementation log
