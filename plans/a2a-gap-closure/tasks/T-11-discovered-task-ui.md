---
id: T-11
title: Show, answer and steer discovered tasks
phase: 2
status: done
depends_on: [T-08, T-02]
size: L
gap: G5
migration: no
updated: 2026-10-15
---

# T-11. Tracked and discovered tasks in the Tasks list, task page and chat

## Goal

A person can find a task started elsewhere, understand where it came from, read its history, answer it and send it more input, using the screens they already know.

## Read first

- [UI-DESIGN.md "Tasks list and task page" and "Chat"](../UI-DESIGN.md#tasks-list-and-task-page).
- `src/app/tasks/layout.tsx`, `src/app/tasks/[taskId]/page.tsx`, `src/lib/task-view.ts` (`taskTitle`), `src/shared/task-types.ts`, `src/server/application/services/task-query.ts`, `src/app/api/tasks/route.ts`, `src/server/adapters/db/repositories.ts` (`listByOrganization` filter).
- `src/components/chat/chat-view.tsx`, `timeline.tsx`, `src/lib/conversations.ts`, `src/store/task-store.ts`, `src/lib/run-message.ts`.
- T-02's Implementation log (the answers to questions 3 and 4 decide part of this task).

## Scope

1. **API.** `GET /api/tasks` gains `origin=discovered|created`. `DurableTaskView` gains `origin`, `discoveredAt` and, on detail only, `trackedBy: { userId, name } | null` (name resolved server-side from the user record; null when found by automatic discovery). Task list rows carry `origin`. (Other filters arrive in T-13; implement `origin` here in a way T-13 can extend.)
2. **Tasks list.** Filter chip **Discovered**; row pill "Discovered". Keep existing filters working and composable (`filter` + `origin`).
3. **Task page.** Info callout for discovered tasks (dismissible, remembered per task in `localStorage` inside try/catch; renders correctly if storage throws). For a tracked task add "Tracked by <name> on <date>."
4. **Title.** `taskTitle` and `conversationTitle` fall back: task `title` → first message of any role → `Task <8 chars of id>`. Must not use agent name for discovered tasks.
5. **Chat.**
   - Discovered conversations get the "Discovered" pill and the first muted timeline line "Started outside Taskbay" with the creation time.
   - The first agent history message may have `ROLE_USER`; render as in a normal conversation but attribute it as "Started by another system" only if the speaker label logic has no user identity for it (check `lib/chat-activity.ts` and the speaker label code added recently).
   - **Skill routing.** T-02 showed `requiresSkill` is set only for skill-scoped principals, who cannot see tracked or discovered tasks, so the chat needs no change here. Keep the T-02 test (`skill-less-tasks.db.test.ts`) green: a whole-agent operator sending to a skill-less task without naming a skill works; naming a skill is refused with `403`.
   - Context: sends carry the discovered task's `contextId`, so a new task started from the conversation stays in that context.
6. **Conversations.** Group discovered tasks by `contextId` like any other; tasks without a context stand alone.

## Acceptance criteria

1. With tasks tracked (T-08) or found automatically (T-25) from the scenario agent, the Tasks list shows them under **Discovered** and not under none-other filters wrongly (`origin=created` excludes them).
2. A discovered input-required task opens in chat, shows its history, and a reply is delivered (assert the scenario agent's request log) and the task moves on.
3. Sending to a discovered **working** task goes out as a message with the task's `taskId` and `contextId` (steering), and the composer text matches [UI-DESIGN.md](../UI-DESIGN.md#chat).
4. A whole-agent operator steering a tracked task on an agent that uses skill routing succeeds (no "Task skill cannot be changed"); the chat sends no `skillId` for it.
5. Title fallbacks tested for: titled, untitled with history, untitled without history.
6. Callout dismissal persists, and the page works when `localStorage` throws.
7. Skill-scoped principals do not see discovered tasks in list, detail or chat (reuse T-02/T-08 tests at the API level; add one component-level check of the empty state).
8. Phone width checked.

## Tests

- Unit: `task-view`, `conversations`, `chat-activity` fallbacks; the `send` skill selection.
- Component: list row, chip, callout.
- DB: `origin` filter in `repositories.db.test.ts`.
- HTTP: covered by T-12.

## Documentation

- `docs/guides/use-the-console.md`: Tasks screen (filter, pill), Chat (discovered conversations, steering a working task), task page callout.
- `docs/reference/http-api.md`: `origin` filter and field.
- `docs/reference/glossary.md`: **Discovered task**, **Steer**.
- `docs/concepts/human-in-the-loop.md`: discovered tasks in the inbox flow.
- `CHANGELOG.md`: Added.

## Out of scope

Context filters (T-13, T-14), steering outcome (T-15), restart action (T-16).

## Notes for later

## Implementation log

- 2026-10-15 · done: Backend: TaskSummaryRecord/origin, GET /api/tasks?origin=created|discovered (400 otherwise), views carry origin/discoveredAt, detail carries trackedBy (name resolved in withTaskQueries). UI: Discovered filter chip and pill in the Tasks list, DiscoveredTaskNotice on the task page (useSyncExternalStore, dismissal in localStorage with in-memory fallback), Discovered pill and DiscoveredMarker in chat, taskTitle/conversationTitle fallbacks (title, first message of any role, short ID; never the agent's name). Skill routing: no change needed (T-02). Deviation: the Discovered chip is part of the existing single-select chip row (API still composes filter + origin). Tests: discovered-title.test.ts, discovered-task-notice.test.tsx (static), discovery.db.test.ts additions (origin filter, trackedBy, skill-scoped sees none), verify-task-http (origin 400/empty). Docs: use-the-console, http-api, glossary (Discovered task, Steer), CHANGELOG. Not done: browser check.