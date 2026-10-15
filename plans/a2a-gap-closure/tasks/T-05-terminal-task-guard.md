---
id: T-05
title: Refuse follow-ups and cancels on finished tasks
phase: 1
status: done
depends_on: [T-03]
size: M
gap: G3
migration: no
updated: 2026-10-15
---

# T-05. Terminal task guard

## Goal

The API enforces what the chat UI already assumes: a finished task cannot be continued or cancelled. The caller learns this immediately and is pointed at "start a new task in the same context".

## Read first

- `src/server/runtime/commands.ts` `acceptCommandWithin` (the `task` lookup by `taskId`).
- `src/server/application/services/task-freshness.ts`, `ports/reconciliation.ts` (`terminalTask`), `reconcile-task.ts`, and how to enqueue an immediate `GetTask` cursor read.
- `src/lib/conversations.ts` (`isOpenTask`), `chat-view.tsx` (target selection ignores terminal tasks).

## Scope

1. In `acceptCommandWithin`, when `task` exists and its stored state is terminal (`COMPLETED`, `FAILED`, `CANCELED`, `REJECTED`), throw `CommandError` `409`, `kind: "task_terminal"`, message "This task is finished. Start a new task in the same conversation." before anything is saved. A2A terminal states are final, so no freshness refresh is needed (the original spec asked for one; dropped because a terminal state cannot legitimately be stale). If the agent says otherwise, T-03's `rejected` handling covers it.
2. Applies to `send` with a `taskId` and to `cancelTask`. A `send` without `taskId` (a new task in the same context) is unaffected.
3. The chat's **Start new task** action is built in T-04 together with the shared error component.

## Acceptance criteria

1. DB test: sending to a stored-terminal task whose agent state is still terminal returns `409 TASK_TERMINAL` and creates no command row.
2. DB test: `cancelTask` on a terminal task is refused the same way.
3. DB test: a `send` with `contextId` and no `taskId` after a task ended is accepted.
4. HTTP: cancel and send to a finished task return `409` with `kind: task_terminal`.

## Tests

- DB: `terminal-guard.db.test.ts` (added to `test:db`).
- Unit: the chat fallback.
- HTTP: add a case to `scripts/verify-task-http.mjs`.

## Documentation

- `docs/reference/http-api.md`: `409 TASK_TERMINAL` for send and cancel, with the body.
- `docs/concepts/durable-tasks.md` or `docs/guides/use-the-console.md`: "A finished task cannot be continued; start a new one in the same conversation."
- `CHANGELOG.md`: Changed.

## Out of scope

Retrying cancel when the agent says not cancelable (T-03/T-04 handle that).

## Notes for later

## Implementation log

- 2026-10-15 · done: acceptCommandWithin refuses send/cancel to a stored-terminal task with 409 kind task_terminal before saving anything. Deviation from spec: no freshness refresh, because A2A terminal states are final (documented in the task). Tests: terminal-guard.db.test.ts (added to test:db) and verify-task-http.mjs (cancel and send after finish return 409 task_terminal; passes against a fresh build). Docs: http-api, durable-tasks, CHANGELOG. The 'Start new task' button moved into T-04. Not run: PostgreSQL profile.