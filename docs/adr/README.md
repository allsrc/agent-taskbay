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
- [0007 — Durable commands, uncertain outcomes, and local dispatch](./0007-command-dispatch-and-local-worker.md)
- [0008 — Durable worker subscriptions and committed browser event views](./0008-worker-owned-subscriptions.md)
- [0009 — Authenticated task push and durable registration lifecycle](./0009-authenticated-task-push.md)
- [0010 — Scoped task reconciliation with durable read cursors](./0010-task-reconciliation.md)

- [0011 — Versioned task content projections and atomic rebuild](./0011-versioned-task-projections.md)
- [0012 — Application SSE over committed projections](./0012-application-freshness-signals.md)
- [0013 — Plane A library adapters and membership-bound sessions](./0013-plane-a-sessions-and-membership.md)

- [ADR 0014: Service credentials and scoped security](0014-service-credentials-and-scoped-security.md)

- [0019 — Unified inbox read model](./0019-unified-inbox-read-model.md)
