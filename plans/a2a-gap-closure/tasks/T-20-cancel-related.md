---
id: T-20
title: Cancel a task and its related tasks, one by one
phase: 4
status: todo
depends_on: [T-19, T-05, T-04]
size: M
gap: G9
migration: no
updated:
---

# T-20. Assisted cancel of related tasks

## Goal

Cancelling a parent does not stop its children in A2A. Give people one dialog to choose and cancel the related tasks they may operate, with each result shown separately. Nothing cascades automatically.

## Read first

- [UI-DESIGN.md "Cancel with related dialog"](../UI-DESIGN.md#cancel-with-related-dialog-t-20).
- `src/app/tasks/[taskId]/page.tsx` (`cancel`), `chat-view.tsx` (`cancelTask`), T-04's `CommandError` and `parseCommandFailure`, T-05's `TASK_TERMINAL`.
- `src/server/application/services/authorization.ts` and how `operate` is evaluated per agent and skill.

## Scope

1. `related.*` items (T-19) carry `canOperate: boolean` and `cancelable: boolean` (non-terminal). Compute `canOperate` on the server from the caller's grants; never rely on the client.
2. Dialog per UI-DESIGN: checkboxes for the task and each cancelable related task the person can operate; non-operable ones shown disabled with the reason. Default: only the current task checked **unless** the person opened the dialog via "Cancel this and related", which pre-checks all operable ones.
3. Run cancels **sequentially**, each as an ordinary idempotent cancel command with its own key. Show each task's result using T-04's copy. Stop on none; continue past failures.
4. Audit: after the run, write one `task.cancel.related` event per run listing counts only (requested, canceled, refused, failed) through an existing audit route or a small `POST /api/tasks/:id/workflow/cancel-related/audit`; prefer reusing an existing mechanism (`runtime/audit.ts`). The individual cancels are already audited.

## Acceptance criteria

1. With three linked scenario-agent tasks: select two, both end `CANCELED`; the third is untouched.
2. A related task on an agent the person cannot operate is disabled and never sent.
3. One refused cancel (`task_not_cancelable`) does not stop the others; the result list shows it.
4. Reloading mid-run and rerunning does not double-cancel (same keys are not reused; terminal tasks are filtered out on reload).
5. Keyboard operable; phone width.

## Tests

- DB: `canOperate` computation for admin, operator, viewer, skill-scoped. Component: dialog states with a mocked fetch sequence.

## Documentation

- `docs/guides/use-the-console.md` and `docs/concepts/human-in-the-loop.md`: the dialog, and that cancellation is a request the agent may refuse.
- `docs/reference/http-api.md`: `canOperate`, `cancelable`.
- `docs/guides/notifications.md` or the audit events page: `task.cancel.related`.
- `CHANGELOG.md`: Added.

## Out of scope

Automatic cascade, cancelling across organizations.

## Notes for later

## Implementation log
