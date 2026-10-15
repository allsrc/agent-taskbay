---
id: T-19
title: Track related tasks from referenceTaskIds
phase: 4
status: todo
depends_on: [T-11]
size: M
gap: G9
migration: yes
updated:
---

# T-19. Related tasks

## Goal

Show which tasks refer to which, across agents the person can read, so a parent task and the work it delegated are visible together. A2A has no hierarchy; this is a link, not a tree (D-04, D-08).

## Read first

- [DECISIONS.md D-04, D-08](../DECISIONS.md).
- `application/services/observe-task.ts` (where messages are appended), `versioned-task-projection.ts` (message `referenceTaskIds`), `task-query.ts` (`referenceLinks`), `src/shared/task-types.ts`.
- `adapters/db/entities.ts` (how entities, uniques and indexes are declared), `migrations/`.
- `commands.ts` validation of `referenceTaskIds` (must be known tasks for the same agent and tenant).

## Scope

1. **Migration.** Table `task_links(id uuid pk, organization_id, from_task_id, to_task_id, kind text, created_at)`, unique `(from_task_id, to_task_id, kind)`, index on `to_task_id`; next free migration number. `kind` is `references` only.
2. **Derivation.** When a message (user or agent) with `referenceTaskIds` is projected, upsert a link from the message's task to each referenced task **that Taskbay knows** (same organization; the referenced id is resolved by `(agent, tenant, remote id)`; across agents is allowed only when the message metadata names no agent, so for now same agent and tenant only; record this limit). Unknown references are ignored without error. Idempotent on replay and on `projections:rebuild`.
3. **Read.** `task-query.ts` `detail` returns `related: { references: [...], referencedBy: [...] }` with `{ localId, taskId, agentName, state, title }`, filtered through `taskAccessFilter` so a person never sees a task they cannot read, not even its title.
4. **UI.** "Related tasks" section on the task page per [UI-DESIGN.md](../UI-DESIGN.md#tasks-list-and-task-page), two groups labelled `References` and `Referenced by`. Hidden when empty. Phone width.
5. Keep `referenceLinks` working until nothing reads it; remove it only if you update every reader in this task.

## Acceptance criteria

1. A task created with `referenceTaskIds = [A]` links to A; A's page lists it under `Referenced by`.
2. Replaying the ledger or rebuilding projections produces the same links, no duplicates.
3. A skill-scoped principal does not see links to tasks they cannot read.
4. Deleting nothing: when a task is removed or an agent disabled, links remain and the UI shows the remaining task state without error (check how the repository treats disabled agents).
5. Upgrade test and `db:schema:check` pass.

## Tests

- DB: `task-links.db.test.ts` (**add to `test:db`**): derivation, idempotency, visibility, rebuild. Component: the section.

## Documentation

- `docs/reference/data-model.md`: `task_links`.
- `docs/guides/use-the-console.md`: Related tasks.
- `docs/concepts/human-in-the-loop.md`: how related tasks help when an agent delegates.
- `docs/reference/http-api.md`: `related`.
- `docs/reference/glossary.md`: **Related task**.
- `CHANGELOG.md`: Added.

## Out of scope

Cross-agent links by URL, lineage extensions, automatic cancel.

## Notes for later

## Implementation log
