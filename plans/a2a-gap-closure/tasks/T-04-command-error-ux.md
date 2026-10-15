---
id: T-04
title: Show command failures by kind in the console
phase: 1
status: done
depends_on: [T-03]
size: M
gap: G1
migration: no
updated: 2026-10-15
---

# T-04. Command error UX

## Goal

Every place a person sends a message or cancels a task shows what actually happened, with the right next step, instead of a generic failure toast.

## Read first

- [UI-DESIGN.md "Command errors"](../UI-DESIGN.md#command-errors-everywhere-a-send-or-cancel-can-fail) (the copy table is the spec).
- `src/components/chat/chat-view.tsx` (`send`, `cancelTask`, `error` state), `src/lib/run-message.ts`, `src/app/tasks/[taskId]/page.tsx` (`cancel`), `src/components/a2a/primitives.tsx` (`Callout` or equivalent).
- `src/lib/api-response.ts` and the `409` body from T-03.
- `src/server/runtime/task-persistence.ts` or the task read route: how to refresh one task after a cancel refusal.

## Scope

1. A shared client component `src/components/a2a/command-error.tsx`: props `{ kind?: string; message?: string; onRetry?; onStartNew? }`. Copy comes from a single typed map keyed by `kind` (the table in UI-DESIGN). Unknown `kind` and a missing `kind` both render the `uncertain` copy when the API said `uncertain`, otherwise a generic "The agent could not complete this request." The agent's `message` is rendered below as quoted, truncated (200 chars) plain text, never as HTML or markdown, and never used to choose copy.
2. A client helper `parseCommandFailure(response, body)` in `src/lib/command-failure.ts` returning `{ kind, message, status }`. Used by chat send, chat cancel and task-page cancel.
3. **Start new task.** For `task_terminal` the component's `onStartNew` re-sends the same parts without `taskId` and with the same `contextId` (test it). Replace the generic error handling in those three places. `task_not_cancelable` triggers one refetch of the task and shows the refreshed state. `task_not_found` offers nothing to retry.
4. Keep toasts for success only. Failures use the inline component so they persist.
5. The wire panel (`wire-panel.tsx`) keeps showing the raw error entry unchanged.

## Acceptance criteria

1. For every `kind` in T-03 plus `uncertain` and `task_terminal` (from T-05), a component test asserts the exact copy and that agent text is shown only as quoted text.
2. Chat: sending to the scenario agent configured with `UnsupportedOperationError` shows the `unsupported_operation` copy and the composer remains usable.
3. Task page and chat: cancelling a task the scenario agent refuses shows the `task_not_cancelable` copy, and the displayed state refreshes.
4. `message` containing `<script>` or markdown renders as inert text.
5. No new color values; tones use the existing `Callout` tones.
6. Works at 360 px width.

## Tests

- Unit/component (Vitest + Testing Library, as in `src/components/chat/structured-form.test.tsx`): the component and `parseCommandFailure`.
- Extend an existing HTTP suite only if a UI-independent API assertion is missing; the API is covered in T-03.

## Documentation

- `docs/guides/use-the-console.md`: a short "When a send or cancel fails" section with the table of messages and what each means.
- `docs/operations/troubleshooting.md`: link each console message to its cause (extends T-03's rows).
- `CHANGELOG.md`: Changed.

## Out of scope

Server behavior (T-03), terminal and extension errors' server side (T-05, T-06). The component must already render their kinds so those tasks only need to produce them.

## Notes for later

## Implementation log

- 2026-10-15 · done: components/a2a/command-error.tsx (copy per kind, agent text never selects copy, plain-text truncated message only for failures Taskbay has no words for), lib/command-failure.ts (CommandFailure, failureFromResponse/Error), sse.ts and client-stream.ts carry kind, stream route now emits kind + fixed message for refused/uncertain commands, chat-view and task page use the component (cancel failures persist inline; task_not_cancelable/task_terminal re-read the task), Start new task re-sends the last parts without taskId in the same context. Deviations: tests are static renders (no jsdom in the repo), so the Start-new-task click and the chat integration are not exercised in a browser; copy for kinds the UI spec did not list (push_not_supported, extended_card_not_configured) added. Verified: tsc, eslint, npm test 387, verify-task-http (stream error carries kind, no agent text), build. Not done: visual check in a running browser; PostgreSQL profile.