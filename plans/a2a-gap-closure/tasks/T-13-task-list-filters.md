---
id: T-13
title: ListTasks-style filters and cursor paging on /api/tasks
phase: 3
status: todo
depends_on: [T-11]
size: M
gap: G7
migration: no
updated:
---

# T-13. Task list filters

## Goal

The task list API can be filtered the way A2A's `ListTasks` can: by context, agent, update time and origin, with stable cursor paging, so large lists and context views are fast.

## Read first

- `src/app/api/tasks/route.ts`, `application/services/task-query.ts`, `adapters/db/repositories.ts` (`listByOrganization`, `listContentPage`), `src/server/adapters/db/entities.ts` (task indexes).
- `src/app/tasks/layout.tsx` (offset paging in the UI), `src/lib/use-server-resource.ts`.
- `docs/reference/http-api.md` Tasks section.

## Scope

1. New query parameters on `GET /api/tasks`: `contextId` (string ≤ 255), `agentId` (uuid), `updatedAfter` (ISO 8601), `origin` (from T-11), and `after` (opaque cursor) as an alternative to `offset`. Reject `after` together with a non-zero `offset` with `400`.
2. Cursor: base64url of `{ updatedAt, id }` of the last row; ordering stays `updated_at desc, id asc`. Return `next` (cursor or null) in the response next to `tasks`.
3. All filters are applied **inside** `taskAccessFilter`; a filter can never widen visibility.
4. Add an index `(organization_id, agent_id, tenant, remote_context_id)` **only if** `EXPLAIN` on PostgreSQL shows a sequential scan at 50 000 tasks. If it is needed this task becomes a migration task: set `migration: yes` before starting and take the next number. Record the evidence in the log either way.
5. UI: switch the Tasks list from offset to cursor paging (**Next** uses `next`; **Previous** keeps a stack of cursors). Keep the current look.

## Acceptance criteria

1. Each filter works alone and combined; invalid values return `400` with a field message.
2. Paging through 130 seeded tasks with `limit=50` returns each exactly once, in order, including when `updated_at` values tie.
3. A skill-scoped principal gets only their tasks for every filter combination.
4. The list screen still works at phone width and with the existing filter chips.
5. Backward compatible: `offset` still works.

## Tests

- DB: `repositories.db.test.ts` (filters, ties, cursor), `scoped-security.db.test.ts` (visibility).
- Unit: cursor encode/decode.
- HTTP: add cases to `scripts/verify-task-http.mjs`.

## Documentation

- `docs/reference/http-api.md`: parameters, cursor, response shape, errors.
- `docs/guides/use-the-console.md`: only if visible behavior changes.
- `CHANGELOG.md`: Added.

## Out of scope

Context UI (T-14).

## Notes for later

## Implementation log
