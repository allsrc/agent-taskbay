---
id: T-19
title: Track related tasks from referenceTaskIds
phase: 4
status: done
depends_on: [T-11]
size: M
gap: G9
migration: yes
updated: 2026-10-15
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

- 2026-10-15 · done: branch plan/T-19-related-tasks; npm run check passed; desktop and 360px browser checks passed; PostgreSQL variants skipped locally
Implemented on `plan/T-19-related-tasks`, carrying the already completed, uncommitted T-17 work forward.

- Generated `Migration0008_TaskLinks` with the ORM generator, converted it to ESM, and raised `DB_SCHEMA_VERSION` to 8. The additive table has organization and task foreign keys, a unique `(from_task_id, to_task_id, kind)` constraint and an incoming-reference index. Existing tasks are retained on upgrade.
- Added `TaskLinkRecord`, the `TaskLinkRepository` port, `recordTaskLinks` application service and `MikroOrmTaskLinkRepository`. Projection collects references from user and agent messages and resolves known remote IDs only within the same organization, agent and tenant. Unknown IDs cause no fetch, task creation or error. Ingestion uses durable identity rather than the initiating person's grants; grants are enforced on reads.
- Normal observation records links inside the existing task transaction. Projection rebuild activation records the same links after its optimistic revision check. Upserts preserve existing rows and avoid duplicates on replay, repeat rebuilds and restarts. A rebuild restores links if the derived table's rows are lost.
- Task detail and subscription-feed detail return `related.references` and `related.referencedBy` with local/remote IDs, agent name, title and current stored state. The repository applies `taskAccessFilter` to the source and every linked task before returning any summary. Lists omit `related`; `referenceLinks` remains unchanged for existing readers.
- Added the **Related tasks** card with both direction labels, state pills, safe local links and hidden empty groups. Long titles wrap without expanding the task page. The task page now explicitly uses a zero-minimum single-column grid below the desktop breakpoint; the browser check caught the previous implicit grid's horizontal overflow.
- Tests: `task-links.db.test.ts` (upgrade, both user/agent references and directions, duplicate input, replay, repeat rebuild, reconstruction, cycles, two organizations, repeated IDs across agents/tenants, skill-scoped filtering, hidden source access, ingestion under a restricted principal, malformed cross-organization relationships, disable/remove and restart); added to the explicit `test:db` list. `related-tasks.test.tsx` covers both groups, empty states, fallback titles, escaping and local destinations. `verify-steering-http.mjs` verifies the restarted task and its predecessor link in both directions. Existing content-versus-detail comparisons exclude the new query enrichment, as they already exclude context and steering fields.
- Updated data model, API, console guide, glossary, human-in-the-loop concept, compatibility, status, threat model, CLI, upgrade notes and changelog. Existing history can be populated through a projection rebuild after migration; a later new projection also derives its known references.
- Browser verification used the production build at 1200px and 360px with a long unbroken reference title: content stayed within the viewport (345px content / 345px available at phone width), both direction groups were present, and clicking **Referenced by** opened the correct local task. Temporary servers and browser outputs were cleaned out of the checkout.
- Verification: `npm run check` passed (564 unit tests, 45 database tests, migrations, schema check, production build and every HTTP suite, including bidirectional restart links). Focused component/database/rebuild suites and TypeScript also passed. PostgreSQL variants are wired into the same contracts but skipped locally because `A2A_TEST_POSTGRES_URL` is unset; the local Docker daemon is unavailable.

Hosting profiles and limits:

- Rules 1, 2, 3, 6, 7: all state is in the database, task transactions and unique upserts make replay safe across instances, every new query scopes the organization, and both database variants are present. Stream, command, reconciliation, push and separate-worker ingestion share the same observer. No new job or per-process state is added. Only PGlite ran locally.
- Rule 4: migration is additive; apply it before new web/worker code. Older instances can coexist without deleting links; only updated instances derive them. Rule 5: the existing sample agents and chat reference selection can exercise the feature, with no extra setup. Rules 8 and 9: this adds a visible read model, no background behavior or secrets; agent removal retains history and relationships.
- Limits are deliberate: reference resolution is same-agent/same-tenant only, unknown IDs are ignored until another projection or rebuild can resolve them, and references do not imply hierarchy, dependency ordering or automatic cancellation. Physical task deletion is not a supported repository operation; removal disables the agent and keeps its task rows.
