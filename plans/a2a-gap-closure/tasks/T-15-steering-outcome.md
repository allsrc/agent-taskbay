---
id: T-15
title: Show what happened to a message sent to a running task
phase: 3
status: todo
depends_on: [T-04, T-11]
size: M
gap: G8
migration: no
updated:
---

# T-15. Steering outcome

## Goal

When someone sends more input to a task that is already working, they can see whether it was delivered, whether the agent responded, or whether the agent refused. Taskbay claims nothing about what the agent did internally (WF-40, WF-41).

## Read first

- [DECISIONS.md D-06](../DECISIONS.md#d-06-steering-outcome-is-computed-not-stored) and [UI-DESIGN.md "Chat"](../UI-DESIGN.md#chat).
- `application/services/task-query.ts` (`detail`/`view`), `adapters/db/*` commands repository (`findById`, listing by task), `versioned-task-projection.ts` (message ids and ordering), `src/shared/task-types.ts`.
- How user messages are stored: `ObserveTaskService` `userMessage` path; command row `messageId`.

## Scope

1. **Read model.** `TaskQueryService.detail` adds `steering: Array<{ messageId, commandId, sentAt, outcome, errorKind? }>` for each user message sent when the task was in `WORKING` or `SUBMITTED` (state at send time: take the state from the last ledger event before the user message). Outcome rules, evaluated at read time:

   | Outcome | Rule |
   | --- | --- |
   | `refused` | The command for that message is `rejected` (T-03) |
   | `delivered` | The command succeeded and nothing from the agent has arrived after `sentAt` |
   | `responded` | The command succeeded and the ledger has any agent message, status update or artifact with a later position than the user message |
   | `waiting` | The command is `pending` or `dispatching` |
   | `unknown` | The command is `uncertain` or `failed` |

   Never infer that the agent "used" or "ignored" the instruction.
2. Repository method to read commands by `(organization, task, messageIds[])` in one query.
3. **UI.** The chip under the message per [UI-DESIGN.md](../UI-DESIGN.md#chat). "Waiting" becomes the text "No response yet" after 60 s on the client without a server change. The composer placeholder for working targets from T-11 stays.
4. Add the `steering` field to `DurableTaskView` and keep it out of list responses.

## Acceptance criteria

1. Scenario agent with defaults: steering a working task yields `responded` once the agent emits anything later.
2. `ignoreInputWhileWorking`: stays `delivered`.
3. `rejectInputWhileWorking`: `refused` with `errorKind = unsupported_operation`.
4. A message sent to a task in `INPUT_REQUIRED` (a normal reply) has **no** steering entry.
5. Outcomes are stable when the task is rebuilt from the ledger (`npm run db:projections:rebuild`).
6. No new table or column.

## Tests

- DB: `task-observation.db.test.ts`/`commands.db.test.ts` extension for each outcome.
- Component: chip states, including the 60 s text via fake timers.

## Documentation

- `docs/guides/use-the-console.md`: "Sending more input to a running task", the four outcomes and what they do not mean.
- `docs/concepts/human-in-the-loop.md`: a paragraph: Taskbay delivers the message; the agent decides.
- `docs/reference/http-api.md`: `steering`.
- `docs/reference/compatibility.md`: note that A2A defines no live steering.
- `CHANGELOG.md`: Added.

## Out of scope

The restart action (T-16).

## Notes for later

## Implementation log
