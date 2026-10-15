---
id: T-15
title: Show what happened to a message sent to a running task
phase: 3
status: done
depends_on: [T-04, T-11]
size: M
gap: G8
migration: no
updated: 2026-10-15
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

Done on branch `plan/T-15-T-16`.

- **Read model.** `src/server/application/services/steering.ts` (`computeSteering`, `readSteering`) derives `steering` at read time from the ledger and the commands; `TaskQueryService.detail` adds it when given the sources (`withTaskQueries` supplies them). Type `SteeringEntry` in `src/shared/task-types.ts`. List rows and snapshots carry no `steering`. No migration, no new column.
- **Repository.** `TaskCommandRepository.findSendsByMessageIds` (one query by organization, agent, tenant and message ids) and `listUnsettledSends` (non-succeeded sends since the task was created, newest 50).
- **UI.** `components/chat/steering-chip.tsx` (outcome pill; "Waiting for a response" becomes "No response yet" after 60 s in the browser). `chat-view.tsx` reads the task detail when a task's version or state changes and after a send, and shows the chip under the message. The composer hint now reads "Send more input to the running task. The agent decides whether to use it."
- **Tests.** `steering.db.test.ts` (every outcome; a reply to an `INPUT_REQUIRED` task has no entry; another organization sees nothing; the PostgreSQL variant runs when `A2A_TEST_POSTGRES_URL` is set), `steering-chip.test.tsx`, and `scripts/verify-steering-http.mjs` (acceptance 1 to 3 against the scenario agent).
- **Docs.** use-the-console, human-in-the-loop, http-api, compatibility, cli, development (port variable), CHANGELOG.
- **Hosting profiles.** Rules 1 (nothing kept in process memory; read from the database per request), 3 (queries filter by organization; tested) and 6 (the db test runs on both databases when configured) apply. Rules 2 and 7 are not affected: no background work was added.

Deviations and decisions:

- A refused, waiting or uncertain command never puts its message in the ledger (the dispatcher records the user message only when the command succeeds), so those entries cannot be found from the ledger. The commands table has no task column, so `listUnsettledSends` reads recent non-succeeded sends for the same agent and tenant and matches the task from the archived payload (`taskId`), then checks against the ledger that the task was `SUBMITTED` or `WORKING` at that time. These entries also carry `text` (first 2000 characters) so the console can still show the message. Cost: one archive read per such command (at most 50) per detail request.
- "Agent activity after the message" counts: an agent message with an ID not seen before, a new artifact or any artifact event, any streamed status update, and any state change. A repeated task snapshot with nothing new (what an agent that ignores input returns) does not count.
- Acceptance 5 (rebuild stability) holds by construction (the outcome uses only the ledger and the command rows); it was not checked by running `db:projections:rebuild`.

- 2026-10-15 · done: branch plan/T-15-T-16; tests: steering.db.test.ts, steering-chip.test.tsx, verify-steering-http.mjs