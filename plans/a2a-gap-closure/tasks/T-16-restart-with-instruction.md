---
id: T-16
title: Stop and restart a task with a new instruction
phase: 3
status: todo
depends_on: [T-15, T-05]
size: M
gap: G8
migration: no
updated:
---

# T-16. Restart with this instruction

## Goal

A guided, honest way to change direction: cancel the running task, then start a new task in the same context that references the old one. Two ordinary commands, shown as two steps (D-07).

## Read first

- [DECISIONS.md D-07](../DECISIONS.md#d-07-restart-with-this-instruction-is-client-orchestrated) and [UI-DESIGN.md "Chat"](../UI-DESIGN.md#chat).
- `src/components/chat/chat-view.tsx` (`send`, `cancelTask`, `refIds` / `referenceTaskIds`), `src/lib/run-message.ts`, `components/patterns/responsive-dialog.tsx`.
- `commands.ts` validation of `referenceTaskIds` (the referenced task must be known).

## Scope

1. In the message actions of a user message that has a steering entry (T-15) and whose task is still non-terminal, add "Stop and restart with this".
2. Dialog per UI-DESIGN. Step 1 calls the cancel route with a fresh idempotency key stored in component state so a double click cannot create two commands. Step 2 runs only if step 1 returned a command that `succeeded` **and** the refreshed task is `CANCELED`, or the cancel was refused because the task is already terminal (`task_terminal` or `task_not_cancelable` with a terminal refreshed state).
3. Step 2 sends the same parts **without** `taskId`, with the same `contextId` and `referenceTaskIds = [oldRemoteTaskId]`, as a new idempotent command.
4. Failure handling: if step 1 is refused or uncertain, stop; show the T-04 error; offer "Send as extra input instead" (a normal steering send of the same parts). If step 2 fails after step 1 succeeded, say so plainly and offer retry of step 2 only.
5. Both steps appear on the wire panel as usual. Nothing new on the server.

## Acceptance criteria

1. Happy path against the scenario agent: old task `CANCELED`, new task created in the same context, new task's `referenceTaskIds` contains the old id, and the old task shows the new one under related (after T-19; until then via `referenceLinks`).
2. Step 1 refused (`task_not_cancelable` with the task still working): step 2 never runs, no new task exists.
3. Double click or reload mid-way does not create two cancels or two new tasks (idempotency keys).
4. Step 2 failure leaves the cancel done and offers retry of step 2.
5. Copy states that partial work may or may not be kept.
6. Component tests cover each branch; keyboard operable.

## Tests

- Component tests with a mocked fetch sequence; one HTTP check in `scripts/verify-task-http.mjs` for the two-command sequence at API level.

## Documentation

- `docs/guides/use-the-console.md`: the action, its two steps, failure outcomes.
- `docs/concepts/human-in-the-loop.md`: change of direction pattern, linking to `referenceTaskIds`.
- `CHANGELOG.md`: Added.

## Out of scope

Server-side macro endpoint. Preserving partial work.

## Notes for later

## Implementation log
