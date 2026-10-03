# A2A Ops roadmap

This file is the phase-level view of the project. Detailed deliverables,
requirement mappings, verification, and exit criteria live in
[`docs/spec/PHASES.md`](./docs/spec/PHASES.md). The exact current state and next
executable slice live in [`docs/spec/STATUS.md`](./docs/spec/STATUS.md).

## Product direction

Build the open-source operations inbox for an organization's A2A agent mesh:
discover agents, start and track long-running work, resolve human
interventions, preserve artifacts, and prove who decided what. It is not an
agent builder, generic workflow engine, or trace explorer.

## Non-negotiable principles

- Server-mediated A2A access; credentials never reach the browser.
- A2A `Task` is the primary unit of work; chat is one view of it.
- The browser is never the durable source of truth.
- Streams, webhooks, and polling enter one idempotent event-ingestion path.
- Remote IDs are scoped by agent and tenant; local UUIDs are primary keys.
- PostgreSQL semantics are canonical. PGlite is the default local database.
- Binary artifacts live behind an `ArtifactStore`, not in relational rows.
- Every externally visible side effect starts from a transactional outbox.
- Authentication, authorization, and in-task approval are distinct concerns.
- A phase is complete only when its exit criteria are verified.

## Phases

| Phase | Status | Outcome |
|---|---|---|
| 0. Specification baseline | Complete | Product, architecture, data, ADR, and execution contracts are stored in-repo. |
| 1. Persistence foundation | Complete | MikroORM, PGlite/PostgreSQL, migrations, repositories, durable registry and initial task/event storage. |
| 2. Durable task runtime | Complete | Browser-independent commands, stream workers, webhook ingestion, reconciliation, projections, outbox, and live fan-out. |
| 3. Identity and security | Complete | OIDC sessions, encrypted service credentials, teams/agent/skill grants, connection-bound network policy, safe artifacts and card trust; all phase exit criteria verified. |
| 4. Approval-grade HITL | Planned | Typed decisions, assignment, escalation, immutable audit, and notification channels. |
| 5. Operator experience | Planned | Shared queues, saved views, search, SLAs, notes, bulk triage, and agent health. |
| 6. Rich interoperability | Planned | Structured forms, A2UI rendering, optional AG-UI adapter, and extension plugins. |
| 7. Enterprise hardening | Planned | HA, backup/restore, object lifecycle, KMS, load/recovery tests, retention, and administration. |

## Current baseline

The current application already provides:

- an Agent Card-backed catalog and connect flow;
- A2A 1.0 discovery and JSON-RPC/HTTP+JSON clients through the official SDK;
  gRPC is disabled pending a connection-bound resolver adapter;
- streaming sends, task resubscription, cancellation, direct Message replies,
  input/auth-required prompts, and task references;
- task, chat, flow, notification, and settings views;
- deterministic text, Markdown, JSON, CSV, image, audio, video, PDF, and raw
  file rendering;
- wire inspection, sideband extension decoding, Agent Card validation,
  request-size limits, and SSRF checks;
- lint, unit tests, and a production build in CI.

Observed task state and registry data now persist on the server. Tasks views
read that durable state across browser sessions. Chat, orchestration, and current alerts reload server projections in a fresh
browser; task content and notification read marks are no longer persisted. Initial sends and cancellation
use durable outbox dispatch. Workers observe active tasks through leased,
reconnecting subscriptions after browsers close; browser streams read committed
events. Opt-in task push now registers durable configs, authenticates scoped
callbacks and deletes terminal/disabled registrations across worker restarts.
Workers also reconcile known tasks through GetTask polling and scoped ListTasks
pagination, with durable read schedules/cursors and restart recovery. Task detail now uses versioned task/message/artifact projections that can be
rebuilt from retained events and original binary archives while reads remain
available. Application SSE now publishes retryable, content-free freshness
signals over committed projections; Tasks and known durable Chat tasks re-query
after signals/reconnect, with fallback reads. Embedded PGlite and external
PostgreSQL workers share the delivery contract. Phase 2 exit criteria are verified.
Phase 3 combines Plane A membership-bound sessions and roles with encrypted API
key/bearer/OAuth client/mTLS service bindings, explicit team/agent/skill grants,
network/artifact controls, rate budgets and signed-card trust. All Phase 3 exit
criteria are verified. User-delegated OAuth consent/refresh is pending for later
review in [issue #1](https://github.com/shashikanth-gs/a2a-ops/issues/1), after this
service baseline; hardened gRPC also needs a future adapter.
Durable per-user notifications and typed intervention begin Phase 4.

## Cross-cutting work

These are not deferred to a final hardening phase:

- Add tests with every vertical slice.
- Maintain PGlite and PostgreSQL integration coverage from Phase 1 onward.
- Maintain a threat model from Phase 3 onward.
- Keep API errors, logs, and audit records free of secrets.
- Preserve accessibility and responsive behavior in every UI phase.
- Update `docs/spec/STATUS.md` whenever verified execution state changes.

## Source-of-truth links

- [Product specification](./docs/spec/PRODUCT_SPEC.md)
- [Target architecture](./ARCHITECTURE.md)
- [Data model](./docs/spec/DATA_MODEL.md)
- [Detailed phase specifications](./docs/spec/PHASES.md)
- [Current execution status](./docs/spec/STATUS.md)
- [Architectural decisions](./docs/adr)
