---
id: T-07
title: Data model and configuration for task discovery
phase: 2
status: done
depends_on: []
size: M
gap: G5
migration: yes
updated: 2026-10-15
---

# T-07. Data model and configuration for task discovery

## Goal

Store where a task came from and each agent's discovery mode, and read the deployment-wide cap. No behavior yet.

## Read first

- [DECISIONS.md D-02, D-16](../DECISIONS.md) and [ARCHITECTURE.md "Data model changes" and "Hosting profiles"](../ARCHITECTURE.md#data-model-changes-in-migration-order).
- `src/server/adapters/db/entities.ts` (`TaskEntity`, `AgentEntity`, `SyncCursorEntity`), `domain/persistence-model.ts`, `adapters/db/repositories.ts` (`taskRecord`, agent mapping), `adapters/db/schema-version.ts`, `migrations/Migration0001_Baseline.js`, `src/server/runtime/runtime-config.ts`.
- `docs/reference/cli.md` for `npm run db:migration:create`.

## Scope

1. Entities and records as in ARCHITECTURE:
   - `tasks.origin` (`created` | `discovered`, default `created`), `tasks.discovered_at` (nullable), `tasks.tracked_by_user_id` (nullable uuid; null for a task found by automatic discovery).
   - `agents.task_discovery` (`off` | `browse` | `auto`, default `browse`), `agents.task_discovery_history_days` (int, default 7, 0–90), `agents.task_discovery_paused_reason` (nullable text).
   - `sync_cursors.last_full_sweep_at` (nullable).
   - Index `idx_tasks_origin` on `(organization_id, agent_id, origin)`.
2. Generate the next numbered migration with `npm run db:migration:create`, named `Migration<nnnn>_TaskDiscovery`. Raise `DB_SCHEMA_VERSION`. Do not edit earlier migrations.
3. Rolling-upgrade safe: every new column is nullable or has a default, so an older instance keeps working against the new schema (D-16).
4. Map the fields through the records and repositories. Add `agents.setDiscovery(organizationId, agentId, patch)` and `tasks.countDiscovered(organizationId, agentId)`.
5. **Deployment cap.** In `runtime-config.ts` add `taskDiscoveryCap()` reading `A2A_TASK_DISCOVERY`: `off`, `browse` (default) or `auto`; any other value is a startup error that names the variable and lists the allowed values (follow how other enum variables fail). Add `effectiveTaskDiscovery(agentMode, cap)` returning the lower of the two, as a pure function.
6. No other behavior change.

## Acceptance criteria

1. `npm run db:migrate` and `npm run db:schema:check` pass on PGlite and PostgreSQL.
2. A database at the previous version upgrades; existing agents read `browse`, existing tasks `created`.
3. An invalid `A2A_TASK_DISCOVERY` stops startup with a clear message; unset means `browse`.
4. `effectiveTaskDiscovery` table test: `(auto, browse) → browse`, `(browse, off) → off`, `(off, auto) → off`, `(auto, auto) → auto`.
5. Repositories round-trip every new field; a test with two organizations shows no cross-organization leakage for `countDiscovered`.
6. `schema-version.test.ts` passes.

## Tests

DB: extend `database.db.test.ts`, `repositories.db.test.ts`, `migration-startup.db.test.ts`. New db test files go in the `test:db` list. Unit: `runtime-config` tests.

## Documentation

- `docs/reference/data-model.md`: new columns, defaults and the index.
- `docs/reference/configuration.md`: `A2A_TASK_DISCOVERY` (values, default, error).
- `CHANGELOG.md`: Added (configuration variable; internal schema).

## Out of scope

Reading the fields anywhere but the repositories and config (T-08 onward).

## Notes for later

## Implementation log

- 2026-10-15 · done: Migration0002_TaskDiscovery.js (hand-converted to ESM like the baseline; generator emits .cjs, documented in development.md), DB_SCHEMA_VERSION=2; agents.task_discovery/history_days/paused_reason, tasks.origin/discovered_at/tracked_by_user_id + idx_tasks_origin, sync_cursors.last_full_sweep_at; domain/discovery-mode.ts, taskDiscoveryCap() in runtime-config; AgentRepository.setTaskDiscovery, TaskRepository.countDiscovered. Tests: discovery-model.db.test.ts (upgrade with existing rows, round-trip, validation, two orgs; added to test:db), discovery-mode.test.ts; existing database/migration-startup tests updated for two migrations. Verified: migration up/check/down on PGlite, test:db 21 files pass, lint clean. Not run: PostgreSQL (A2A_TEST_POSTGRES_URL unset here). Pre-existing: dompurify missing from node_modules so 4 UI test files and tsc fail to import html-preview (npm ci needed). The configuration-recipes entry moved to T-10 (variable is only enforced then). Existing-agents defaults make new fields optional on the records.