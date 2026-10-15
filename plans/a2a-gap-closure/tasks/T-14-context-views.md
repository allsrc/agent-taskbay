---
id: T-14
title: Show the other tasks in a context
phase: 3
status: done
depends_on: [T-13]
size: S
gap: G7
migration: no
updated: 2026-10-15
---

# T-14. Context views

## Goal

A context can hold many tasks (WF-10). Show them together on the task page, and let the Tasks list narrow to one context.

## Read first

- [UI-DESIGN.md "Tasks list and task page"](../UI-DESIGN.md#tasks-list-and-task-page).
- `src/app/tasks/[taskId]/page.tsx`, `application/services/task-query.ts` (`detail`), `src/lib/conversations.ts`.

## Scope

1. `GET /api/tasks/:id` returns `contextSiblings: Array<{ localId, taskId, state, title, updatedAt }>` for the same agent, tenant and `remoteContextId`, excluding itself, newest first, at most 20, filtered through `taskAccessFilter`. Empty when the task has no context.
2. Task page section "Other tasks in this context" (hidden when empty), each a link with `StateChip`. A link "Show all in the Tasks list" goes to `/tasks?contextId=…&agentId=…`.
3. The Tasks list reads `contextId` and `agentId` from the URL (via `useSearchParams`; read the Next.js docs first) and shows a removable chip "Context: <first 8 chars>".

## Acceptance criteria

1. A context with 3 tasks shows 2 siblings; a skill-scoped principal sees only siblings they may read.
2. The link opens the list narrowed correctly, and the chip clears the filter.
3. No sibling section for a task without a context.
4. Works at phone width.

## Tests

- DB: sibling query and visibility.
- Component: section and chip.

## Documentation

- `docs/guides/use-the-console.md`: Tasks screen.
- `docs/reference/http-api.md`: `contextSiblings`.
- `docs/reference/glossary.md`: **Context** if not present.
- `CHANGELOG.md`: Added.

## Out of scope

Grouping rows in the list by context.

## Notes for later

## Implementation log

- 2026-10-15 · done: branch plan/T-13-T-14; tests: task-list.db (siblings), context-siblings, context-filter-chip, verify-task-http
Done (same branch as T-13). `TaskQueryService.detail` adds `contextSiblings` using the list query (same agent, tenant and context, excluding itself, 20 newest, through `taskAccessFilter`); `components/tasks/context-siblings.tsx` is the task page section; `components/tasks/context-filter-chip.tsx` is the removable chip. The Tasks list layout reads `contextId` and `agentId` with `useSearchParams` inside a `Suspense` boundary (read the Next.js `use-search-params` guide first), keeps the narrowing in state so it survives opening a task, and clears it with the chip. Tests: sibling query and visibility in `task-list.db.test.ts`; component tests `context-siblings.test.tsx` and `context-filter-chip.test.tsx`; HTTP checks in `verify-task-http.mjs`. Docs: `use-the-console.md`, `http-api.md`, `glossary.md`, CHANGELOG. Deviation: `verify-task-http.mjs` and `projection-rebuild.db.test.ts` compared full detail views, so they now ignore `contextSiblings` (it changes as other tasks join the context). Not checked in a browser.
