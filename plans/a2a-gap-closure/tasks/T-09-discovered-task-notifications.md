---
id: T-09
title: Notification and inbox rules for tracked and discovered tasks
phase: 2
status: done
depends_on: [T-08]
size: S
gap: G5
migration: no
updated: 2026-10-15
---

# T-09. Notifications and inbox for tracked and discovered tasks

## Goal

Tracking a task makes it a normal task for the Inbox and notifications from then on, with no first-sight noise. Tasks found by automatic discovery follow the stricter rules in D-13 so nobody is flooded with old news.

## Read first

- [DECISIONS.md D-02, D-13, D-14](../DECISIONS.md).
- `src/server/application/services/observe-task.ts` (the `NOTIFY` map and the `task.state !== view.state` condition), `notification-fanout.ts`, `src/server/domain/notification-model.ts`, `docs/guides/notifications.md`.
- `src/server/adapters/db/inbox-repository.ts` (`NEEDS_INPUT`), `application/services/inbox-query.ts`.
- The temporary guard added in T-08.

## Scope

1. Replace T-08's guard with these rules, decided at the moment the task row is first created in the observing transaction:
   - **Tracked** (`trackedByUserId` set): no notification on first sight, whatever the state. Every later state change notifies like any task.
   - **Automatic** (`trackedByUserId` null, `origin = discovered`): on first sight, state `INPUT_REQUIRED` or `AUTH_REQUIRED` with `status.timestamp` within 24 hours notifies `task.needs_input`; terminal states never notify; `WORKING` and `SUBMITTED` never notify. Later changes notify normally.
2. Notification text and the webhook payload carry `origin: "discovered"` for these tasks, so the in-app title reads "A task started outside Taskbay needs input". The field is additive and documented.
3. Inbox: no query change expected (it keys off state). Prove with tests that a tracked or discovered input-required task appears under **Needs you** for a whole-agent grantee and not for a skill-scoped one, and that a task that is only browsed (never tracked) appears nowhere.
4. Workflow actions (claim, assign, due time, notes) work on tracked and discovered tasks. Add a test.

## Acceptance criteria

1. Table-driven test over (tracked or automatic) × state × age × first-sight or later, matching D-13 and the tracked rule, including the 24-hour boundary.
2. Re-ingesting the same snapshot never notifies twice.
3. A tracked task that later moves `WORKING → INPUT_REQUIRED` notifies once.
4. Webhook payload test: `origin` present for discovered tasks and absent or `created` otherwise; signature scheme unchanged.
5. Inbox and workflow tests pass as in Scope 3 and 4.

## Tests

DB: extend `notifications.db.test.ts`, `inbox.db.test.ts`, `workflow.db.test.ts` (already in the `test:db` list).

## Documentation

- `docs/guides/notifications.md`: tracked and discovered tasks, when they notify, the 24-hour rule for automatic mode, the webhook `origin` field.
- `docs/guides/approvals-and-ownership.md`: tracked tasks can be claimed and assigned; tracking is not claiming.
- `docs/concepts/human-in-the-loop.md`: the path "browse, track, then the Inbox takes over".
- `docs/reference/http-api.md`: webhook payload field, if documented there.
- `CHANGELOG.md`: Added.

## Out of scope

Badges and filters (T-11).

## Notes for later

## Implementation log

- 2026-10-15 · done: observe-task: suppressFirstSight(): a tracked task never notifies on first sight; automatic discovery notifies only for INPUT/AUTH_REQUIRED updated within 24h (no timestamp counts as not recent); later changes notify normally. Fan-out title 'A task started outside Taskbay needs input/authorization' from task.origin. Deviation: no webhook 'origin' field (NotificationRecord is persisted, so it would need another migration; the title carries the origin). Tests: suppress-first-sight.test.ts (table), discovered-notifications.db.test.ts (added to test:db: outbox counts per case, replay, later change, created-origin unchanged, titles, skill-scoped sees nothing, inbox needs-input for whole-agent/admin only, claim works and tracking does not claim). Docs: notifications, approvals-and-ownership, human-in-the-loop, CHANGELOG.