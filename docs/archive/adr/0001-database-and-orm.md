# ADR 0001: PostgreSQL semantics with MikroORM and PGlite

- Status: Accepted
- Date: 2026-10-01

## Context

Local development should require no separately installed database. Enterprise
deployments need PostgreSQL. The application also benefits from JPA-like Data
Mapper, repository, Unit of Work, migration, and transaction patterns.

Using SQLite locally and PostgreSQL in production creates differences in JSON,
timestamps, concurrency, constraints, DDL, and query behavior that can make
local success misleading.

## Decision

- Use MikroORM as the persistence framework.
- Use file-backed PGlite as the default local database.
- Use PostgreSQL as the canonical production database and migration semantics.
- Keep application services behind domain-specific repository ports.
- Permit a SQLite/libSQL adapter later if it passes repository contract tests
  and carries explicit dialect migrations where necessary.
- Do not design the canonical model around SQLite limitations.

## Consequences

- Local development stays zero-install while closely matching production.
- MikroORM EntityManagers must be scoped per request or worker job.
- Database-specific optimizations live in adapters.
- PostgreSQL integration tests remain mandatory even when PGlite tests pass.
- SQLite support is additional compatibility work, not a free connection-string
  switch.

## Alternatives considered

- Prisma: capable, but changing providers and maintaining portable migrations
  is not the desired runtime abstraction.
- Drizzle/Kysely directly: strong SQL-first tools, but less aligned with the
  requested Unit of Work/Entity Repository style.
- SQLite-only local development: rejected because dialect drift would be
  discovered too late.
