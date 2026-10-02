# Execution status

Last updated: 2026-10-03

## Active position

- Last completed phase: **Phase 0 — specification baseline**
- Active phase: **Phase 1 — persistence foundation**
- Next executable slice: **1.4 — first durable task read path**
- Blocking decisions: none

## Accepted implementation choices

- Product name: A2A Ops.
- Formal name: A2A Operations Console.
- Repository slug: `a2a-ops`.
- Tagline: "The human operations console for A2A agent workflows."
- ORM: MikroORM using Data Mapper/Unit of Work/Entity Repository patterns.
- Local default database: file-backed PGlite.
- Production database: PostgreSQL.
- Optional database: SQLite/libSQL adapter after the canonical repositories
  work; it is not allowed to redefine schema semantics.
- Runtime: modular monolith with separate web and worker entry points.
- Reliability: immutable protocol-event ledger, rebuildable projections, and a
  transactional outbox.
- Identity: local UUIDs; remote A2A IDs scoped by agent and tenant.

## Verified baseline evidence

Verified on 2026-10-01 before Phase 1:

- `npm run lint`: passed.
- `npm test`: 7 files and 27 tests passed.
- `npm run build`: passed with all current routes generated.
- `npm audit`: zero reported vulnerabilities.
- Existing user-owned untracked files were left untouched.

The coverage run reported 72.7% statements and 79.35% lines for modules loaded
by the current unit suite. This is not whole-application coverage; API routes,
the gateway, UI flows, and live-agent behavior need explicit tests.

## Phase 1 verified slice evidence

Date: 2026-10-01

Slice: **1.1 — database bootstrap**

Changes:

- Added exact-version MikroORM 7.2.3 core, migrations, PGlite, PostgreSQL, and
  CLI packages. The official drivers resolve PGlite 0.5.8 and `pg` 8.23.0.
- Raised the Node.js floor to 22.17.0, the minimum supported by MikroORM 7.2.3,
  and aligned CI and Node type declarations.
- Added validated `pglite` and `postgresql` configuration. PGlite defaults to
  the file-backed `.data/pglite` directory; PostgreSQL requires a server-only
  URL.
- Added a reload-safe ORM initialization promise plus isolated request and job
  EntityManager helpers. Node-only database packages are externalized from
  Next.js server bundles.
- Added a schema-neutral baseline migration, migration/schema commands, and an
  adapter contract suite shared by PGlite and PostgreSQL.
- Added a PostgreSQL 18 CI service and included database and schema checks in
  the full quality gate.

Verification commands and results:

- `A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test npm run check`:
  passed lint; 8 unit files and 31 tests; 1 database file and 3 tests against
  PGlite and PostgreSQL; migration schema check; and the Next.js 16.3.6
  production build with all 18 routes reported successfully.
- `npm run db:migrate`, `npm run db:migration:list`, and
  `npm run db:schema:check`: the baseline applied, was listed as executed, and
  reported no schema drift.
- `npm audit`: zero reported vulnerabilities.
- `npm ls @mikro-orm/core @mikro-orm/pglite @mikro-orm/postgresql @mikro-orm/migrations @mikro-orm/cli @electric-sql/pglite pg --depth=1`:
  all MikroORM packages resolved to 7.2.3, PGlite to 0.5.8, and `pg` to 8.23.0.

Migration tested from:

- A clean temporary file-backed PGlite directory, followed by close/reopen to
  verify persisted migration state.
- A clean PostgreSQL 18 Alpine database, including rollback and reapplication
  so the contract is repeatable.

Remaining risks:

- Slice 1.1 intentionally has no domain tables. The baseline migration is
  schema-neutral so Slice 1.2 remains the sole owner of the initial entities.
- Node 26 emits a non-failing `module.register()` deprecation warning from the
  MikroORM CLI TypeScript config loader; the supported CI floor is Node 22.17.

Next executable slice at verification time: **1.2 — initial model and ports**.
Implement the six initial persistence entities, narrow application repository
ports, the default local organization bootstrap, and scoped remote-task
identity. Do not begin Slice 1.3.

## Phase 1 Slice 1.2 verified evidence

Date: 2026-10-01

Slice: **1.2 — initial model and ports**

Changes:

- Added plain domain records and ORM-independent repository ports for
  organizations, agents and Agent Card snapshots, tasks, task events, and the
  transactional outbox.
- Added MikroORM mappings and a PostgreSQL-compatible migration for all six
  initial entities, including foreign keys, organization-scoped read indexes,
  event deduplication, outbox readiness indexes, and optimistic task versions.
- Added MikroORM repository adapters that preserve organization scope at read
  boundaries and use one common contract on PGlite and PostgreSQL.
- Added an idempotent `local` organization bootstrap. Runtime ORM initialization
  invokes it after migrations have been applied; tests can invoke the lower
  database initialization boundary without requiring an existing schema.
- Enforced remote task identity with a database unique constraint on
  `(agentId, tenant, remoteTaskId)`. PostgreSQL null semantics intentionally
  allow multiple direct-message records whose `remoteTaskId` is null.

Verification commands and results:

- `A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test npm run check`:
  passed lint; 8 unit files and 31 tests; 2 database files and 6 tests against
  PGlite and PostgreSQL; migration schema check; and the Next.js 16.3.6
  production build with all 18 routes reported successfully.
- `npm run db:migrate`, `npm run db:migration:list`, and
  `npm run db:schema:check`: both the baseline and initial-model migrations are
  applied and listed, with no schema drift.
- `npx tsc --noEmit`: passed.
- `npm audit`: zero reported vulnerabilities.
- `git diff --check`: passed.

Migration tested from:

- A clean temporary file-backed PGlite database through both migrations,
  followed by close/reopen verification.
- The immediately previous baseline-only PGlite schema, upgraded through the
  initial-model migration with no schema drift.
- A clean PostgreSQL 18 Alpine database through the same migration and
  repository contract used by PGlite.

Repository behavior verified:

- Default-organization bootstrapping is repeatable and retains the original
  locally generated UUID and timestamps.
- Agent Card URLs are unique per organization but may repeat across
  organizations; snapshot history returns the latest discovery.
- A remote task ID may repeat across agents or tenants, but the same
  `(agentId, tenant, remoteTaskId)` is rejected by the database.
- Multiple direct-message records with null remote task IDs are accepted.
- Duplicate task-event source keys are ignored, and task-event/outbox reads are
  organization scoped.

Remaining risks:

- The UI still uses the JSON-file registry until Slice 1.3 replaces that
  adapter and migrates existing managed entries.
- Slice 1.2 defines event source-key uniqueness; the canonical digest fallback
  and full ingestion transaction remain Phase 2 work.
- Domain persistence exists, but task list/detail APIs and UI reads remain
  Slice 1.4.

Next executable slice: **1.3 — durable registry**. Replace the JSON-file
managed-agent adapter, preserve environment-seeded non-removable entries,
persist discovery/compliance snapshots, and migrate existing managed entries
idempotently. Do not begin Slice 1.4.

## Phase 1 Slice 1.3 verified evidence

Date: 2026-10-03

Slice: **1.3 — durable registry**

Changes:

- Replaced the JSON-file registry writer with a MikroORM database adapter,
  backed by the existing organization-scoped Agent repository port and a
  framework-independent AgentCatalogService.
- New catalog identities are local UUIDs. Legacy URL-hash IDs remain accepted
  for reads and removal so existing agent links and browser conversations can
  resolve their registered agent.
- Environment-seeded agents are deduplicated, persisted, and non-removable.
  A managed entry overlapping a seed remains protected while configured;
  environment-only entries leave the active catalog when unconfigured while
  keeping their persisted identity and history.
- Catalog and registered-agent detail discovery now atomically append raw and
  normalized Agent Card snapshots, compliance reports, digest, unverified
  signature status, and discovery/healthy timestamps. Wire telemetry is not
  included in the snapshot.
- Legacy agents.json entries are imported transactionally on first registry
  access. The original file is retained unchanged, malformed imports fail
  without partial writes, and failed imports can retry after repair.
- Managed removal disables the record, preserving task references, snapshots,
  and identity. Repeat imports cannot restore removed agents; explicit
  registration re-enables the original UUID.
- Added concurrent registration, restart/recovery, import, rollback, seed
  protection, discovery, and organization-isolation coverage and documented
  the registry migration and configuration.

Verification commands and results:

- Before implementation, the existing full quality gate passed against
  PGlite and PostgreSQL 18: 31 unit tests, 6 database tests, lint, schema check,
  and production build.
- `A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test npm run check`:
  passed lint; 9 unit files and 29 tests; 3 database files and 10 tests across
  PGlite and PostgreSQL; schema check; and the Next.js production build.
- `npm run build`: passed again after excluding runtime import data from
  Turbopack filesystem tracing, with no build warnings.
- `npx tsc --noEmit`: passed.
- `npm audit`: zero reported vulnerabilities.
- `git diff --check`: passed.
- Production HTTP smoke with `next start -p 3103`, a fresh file-backed PGlite
  database, and a local fixture Agent Card server passed: legacy import,
  catalog/detail discovery, old-ID resolution, environment deletion returning
  409, managed registration/removal, and recovery after a complete server
  restart. The removed legacy entry stayed absent and the original JSON file
  stayed unchanged.

Migration tested from:

- Clean PGlite and PostgreSQL 18 databases using the existing migrations.
- The previous baseline-only PGlite schema upgraded to the initial-model
  schema, using the existing shared migration contract.
- Existing agents.json data with duplicates and overlapping environment seeds,
  imported repeatedly across independent registry instances and ORM restart.
- No schema change was required for this slice; the Slice 1.2 schema remains
  current with no drift.

Remaining risks:

- Task views still use browser state until Slice 1.4; Phase 1 is not complete.
- Signature status is explicitly unverified; cryptographic trust and access
  policy remain Phase 3 work.
- Snapshot persistence covers registered-agent catalog/detail discovery.
  Unregistered previews and transport-internal discovery are not snapshot
  writers in this slice.
- Runtime database migrations remain an explicit setup/deployment step.

Next executable slice: **1.4 — first durable task read path**. Persist observed
stream task snapshots/events, add organization-scoped task list/detail query
services and APIs, switch Tasks views to server reads, and add restart/recovery
and remote-ID collision tests. Do not begin Phase 2.

## Known repository-state issue

The working application branch is ahead of the public default branch. Publishing
or merging it is release work and must be handled explicitly; it does not alter
the Phase 1 technical dependency order.

## Status update template

When completing a slice, replace this section with evidence in this form:

```text
Date:
Slice:
Changes:
Verification commands and results:
Migration tested from:
Remaining risks:
Next executable slice:
```
