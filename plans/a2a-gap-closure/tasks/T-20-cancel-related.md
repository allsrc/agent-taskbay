---
id: T-20
title: Cancel a task and its related tasks, one by one
phase: 4
status: done
depends_on: [T-19, T-05, T-04]
size: M
gap: G9
migration: no
updated: 2026-10-15
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

- 2026-10-15 · done: branch plan/T-20-assisted-cancel; npm run check passed; desktop, keyboard and 360px browser checks passed; PostgreSQL variants skipped locally
Implemented on `plan/T-20-assisted-cancel` (the older `plan/T-20-cancel-related` branch already existed at the pre-related-tasks base).

- Task detail and related summaries compute `canOperate` from current server-side role and grants, plus non-terminal `cancelable`; related summaries also carry agent and tenant identity for ordinary cancel requests.
- A shared `CancelTasksDialog` replaces native confirmation in task detail and chat, defaults to the current task, preselects eligible tasks from **Cancel this and related**, deduplicates graph cycles, and shows disabled reasons and per-task results. `cancel-related.ts` sends sequential commands with separate idempotency keys, continues past refusals and failures, checks the actual returned canceled state, refreshes committed task state, and preserves chat wire entries.
- A small authenticated audit route reuses `runtime/audit.ts` and existing immutable audit storage. It records a browser-reported, counts-only `task.cancel.related` summary once per caller/source/run; saving it again never repeats cancels. The audit query and description expose counts in task and command trails. The fixed JSON target avoids a schema migration; individual command records remain authoritative.
- Tests extend the existing PGlite/PostgreSQL relationship contract for administrator, operator, viewer, skill grants, cross-agent read-only links, forged selections, terminal tasks, audit scoping and retry. Projection and HTTP content comparisons exclude caller-specific eligibility fields. Component tests mock fetch to cover defaults, selection, sequential calls, refusals, disabled tasks, uncertain replies, loading errors and summary-only retry. The existing steering HTTP suite also proves selecting two of three linked scenario tasks, refusal followed by success, terminal reload behavior and summary idempotency.
- Updated the console guide, human-in-the-loop concept, API and data-model references, threat model and changelog. Documentation links resolve after excluding inline-code examples from the link scan.
- Hosting rules: (1, 2, 7) commands and summaries use existing durable DB intent/outbox/idempotency and worker paths, no new process state or worker job; (3) reads, cancels and summaries retain organization and grant checks, tested with two organizations; (4) no migration, additive response fields and an event kind older readers tolerate; (5) local defaults and embedded workers remain sufficient; (6) the shared DB contract runs on PGlite and optionally PostgreSQL; (8) explicit UI action and visible results/audit, no new background behavior; (9) summary stores source identity and counts only, no task content or secrets.

Browser acceptance checks (isolated production server, controllable scenario fixture):

- Desktop 1451px: current-only and all-related defaults; Space toggles a checkbox; Tab stays in the dialog after focus guard handoff.
- Phone 360px: drawer and long task title stay within the viewport (345px content width); no horizontal overflow. Captures kept outside the repository in `/var/folders/rq/0t970n8547587w2l1smj0p500000gn/T/taskbay-t20-browser-d0mm7whs/captures/` (desktop, phone, long title and reload PNGs).
- Selected two of three: one refused (`task_not_cancelable`) and the following task still canceled; retrying the remaining current task canceled it while the third stayed `WORKING`.
- After reload, the two `CANCELED` rows were disabled and only the third was selected by **Cancel this and related**. Chat's **Cancel** opened the shared dialog with only its current active task checked and its finished related task disabled.
- The extended `verify-steering-http.mjs` passed independently, including the counts-only summary and duplicate-summary protection.

Final validation: `npm run check` passed (lint, 569 unit tests, 45 database tests, migrations, schema check, production build and every HTTP suite). PostgreSQL variants were skipped because `A2A_TEST_POSTGRES_URL` is unset; the shared contract remains enabled when configured. `npx tsc --noEmit`, targeted component/database tests, changed-document Markdown link checks and `git diff --check` also passed. Desktop, keyboard, 360px and live scenario checks are recorded above.
