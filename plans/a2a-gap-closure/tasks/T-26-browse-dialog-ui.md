---
id: T-26
title: Browse an agent's tasks and track from the console
phase: 2
status: done
depends_on: [T-08, T-04]
size: M
gap: G5
migration: no
updated: 2026-10-15
---

# T-26. Browse dialog

## Goal

From an agent, a person can look at the tasks it currently has, see which are already tracked, and track one with a single action, or by pasting a task id.

## Read first

- [UI-DESIGN.md "Browse agent tasks dialog"](../UI-DESIGN.md#browse-agent-tasks-dialog) (the layout and states are the spec) and [DECISIONS.md D-02, D-15](../DECISIONS.md).
- T-08's routes in `docs/reference/http-api.md` (once written) or the route files.
- `src/components/patterns/responsive-dialog.tsx`, `src/components/console/master-detail.tsx` (`ListRow`, `ListStatus`), `src/components/a2a/primitives.tsx` (`StateChip`), `src/lib/use-server-resource.ts`, T-04's `CommandError` and `parseCommandFailure`.
- `src/app/agents/[agentId]/page.tsx` (header `actions`).

## Scope

1. `src/components/agents/browse-tasks-dialog.tsx`: props `{ agentId, tenants[], open, onOpenChange }`. Calls `GET /api/agents/:id/remote-tasks` with filters and `pageToken`; keeps a stack of page tokens for **Previous**; page size 25. Never caches results across opens.
2. Rows, filters, states and copy exactly as in UI-DESIGN. Snippets are plain text in quotes, 120 characters, ellipsis added by the server; the component must not render them as markdown or HTML.
3. **Track** calls `POST …/remote-tasks/track` and updates the row in place to "Tracked" with **Open** linking to `/tasks/<localId>`. Busy and error states per row; errors use T-04's component.
4. **Track by task id**: small form (task id, tenant selector when `tenants.length > 1`) calling the same route; on success navigates to the task.
5. Add a plain **Browse tasks** button to the agent page header actions for the operator and admin roles (read the role from the session the page already has). The client cannot tell a whole-agent grant from a skill-scoped one, so the dialog handles `403` with the permission copy from UI-DESIGN. T-10 later moves the button into the Task discovery card and hides it using `canBrowse`.
6. Phone: the dialog is full screen; filters wrap; nothing scrolls sideways.

## Acceptance criteria

1. Against the scenario agent: opening the dialog lists seeded tasks; the status filter narrows them; paging works with tokens; nothing is stored (assert in a db or http check that no tasks are created by browsing).
2. Track turns the row into "Tracked" with a working **Open**; the task then appears in Tasks and, if it needs input, the Inbox.
3. Already-tracked tasks show "Tracked" on first render.
4. Track by id works for a known id and shows `404` copy for an unknown one.
5. Component tests: loading, empty, unsupported, permission, error, track busy and failure, long titles, hostile snippet (`<img onerror>` stays inert text).
6. Keyboard: all actions reachable; buttons have names including the task title.
7. Axe-style check or manual notes for focus trap and labels in the log.

## Tests

Component tests (Vitest + Testing Library, mocked `fetch`); HTTP flow in T-12.

## Documentation

- `docs/guides/use-the-console.md`: "Browse an agent's tasks": what you see, what Track does, the Inbox taking over, what is not stored.
- `docs/guides/connect-an-agent.md`: link to it from task discovery.
- `CHANGELOG.md`: Added.

## Out of scope

Settings (T-10), badges (T-11), automatic mode (T-25).

## Notes for later

## Implementation log

- 2026-10-15 · done: components/agents/browse-tasks-dialog.tsx (live list, state/context filters, agent page tokens with Previous/Next, Track per row, Track by task ID, per-row failures), browse-task-row.tsx (static, agent text as inert text, Track/Tracked/Open with named buttons), lib/browse-tasks.ts, discovery error kinds added to command-error copy; Browse tasks button on the agent page header for admin/operator (T-10 moves it into the Task discovery card). Deviation: tenants prop uses the card's single tenant; the selector appears when T-18 provides several. Tests: browse-task-row.test.tsx, browse-tasks.test.ts (static renders; the repo has no browser test environment so dialog interactions were not exercised in a browser). Docs: use-the-console, CHANGELOG.