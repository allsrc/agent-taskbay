# Architectural decision records

ADRs record cross-cutting decisions that future implementation must preserve.

- `Proposed`: under discussion and not binding.
- `Accepted`: binding until superseded.
- `Superseded`: replaced by a newer ADR that links back to it.
- `Rejected`: considered but intentionally not selected.

Create a new ADR rather than rewriting the decision and consequences of an
accepted ADR. Small implementation details do not require an ADR.

## Index

- [0001 — PostgreSQL semantics with MikroORM and PGlite](./0001-database-and-orm.md)
- [0002 — Event ledger, projections, and transactional outbox](./0002-event-ledger-projections-outbox.md)
- [0003 — Local identity for remote A2A resources](./0003-local-and-remote-identity.md)
- [0004 — Modular monolith with separate workers](./0004-modular-monolith-workers.md)
- [0005 — Separate user, agent, and in-task authorization](./0005-authentication-planes.md)

- [0006 — Initial task projections and binary protocol archives](./0006-initial-task-projections.md)
