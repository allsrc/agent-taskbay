# Execution status

Last updated: 2026-10-06

## Active position

- Last completed phase: **Phase 6 — rich interoperability** (Phase 4 complete; Phase 5 paused after 5.1)
- Active phase: **Phase 8 — open-source distribution and developer experience** (in progress; started 2026-10-06 at the user's direction).
  Phase 5 (operator experience) stays paused after slice 5.1, and Phase 7 (enterprise hardening) has not started. Hosting is to be discussed separately.
- Last completed slice: **8.2 — community files and release automation**, with **8.1 — npm package and local launcher** verified the same day
  (Linux, from a local tarball). Phase 6 exit was verified 2026-10-06.
- Next executable slice: the **first publish** (a maintainer step: `NPM_TOKEN` secret and a `v*` tag; see Phase 8 in `PHASES.md`), then
  **5.2 — saved views, search, advanced filters and bulk triage** ([#5](https://github.com/allsrc/agent-taskbay/issues/5)) or Phase 7, as the
  user chooses; the plugin contract is [#26](https://github.com/allsrc/agent-taskbay/issues/26)
- Blocking decisions: none

## Pending follow-ups

- **Client SDK for the Taskbay API — parked:** ADR 0026 (Proposed) and [#31](https://github.com/allsrc/agent-taskbay/issues/31).
  Service-token authentication and a stable `/api/v1` come first. Not scheduled; deferred by agreement on 2026-10-06.
- **Hosting — to be discussed:** container images, Helm or compose, S3/Azure Blob and KMS adapters (Phase 7). The intended topology is
  recorded in `docs/deployment/PRODUCTION_TOPOLOGY.md`.

- **User-delegated OAuth — pending:** consent, membership-bound encrypted tokens,
  refresh/revocation and durable worker subject selection are tracked in
  [GitHub issue #1](https://github.com/allsrc/agent-taskbay/issues/1).
  Deferred by agreement on 2026-10-03 for later review. This is separate from the
  verified Phase 3 service identity baseline and does not block Slice 4.1.

- **Phase 6 plugin contract — deferred:** [#26](https://github.com/allsrc/agent-taskbay/issues/26), by agreement on 2026-10-06; does not block the Phase 6 exit.
- **Phase 6 A2UI follow-ups — tracked:** components [#22](https://github.com/allsrc/agent-taskbay/issues/22), functions and
  `openUrl` [#23](https://github.com/allsrc/agent-taskbay/issues/23), other surfaces [#24](https://github.com/allsrc/agent-taskbay/issues/24),
  real-agent verification [#25](https://github.com/allsrc/agent-taskbay/issues/25).
- **Phase 6 approval follow-ups — tracked:** agent-originated requests [#15](https://github.com/allsrc/agent-taskbay/issues/15),
  bypass and approval-required policy [#16](https://github.com/allsrc/agent-taskbay/issues/16), digest-echo contract
  [#17](https://github.com/allsrc/agent-taskbay/issues/17), ADK adapter [#18](https://github.com/allsrc/agent-taskbay/issues/18),
  upstream extension proposals [#19](https://github.com/allsrc/agent-taskbay/issues/19), AG-UI approval interrupts
  [#20](https://github.com/allsrc/agent-taskbay/issues/20).
- **Phase 5 remainder — deferred:** saved views, full-text search, advanced filters,
  bulk triage, SLA indicators, agent health administration, workflow links and
  notification preferences are tracked in
  [GitHub issue #5](https://github.com/allsrc/agent-taskbay/issues/5). Deferred by
  agreement on 2026-10-05 so Phase 6 could start; Phase 5 exit criteria are still
  unverified and the phase is not complete. Resume at slice 5.2.

- **Phase 6 limitations — tracked:** AG-UI thread-to-context mapping
  ([#8](https://github.com/allsrc/agent-taskbay/issues/8)), skill-scoped principals
  ([#9](https://github.com/allsrc/agent-taskbay/issues/9)), tools/context/state/non-text content
  ([#10](https://github.com/allsrc/agent-taskbay/issues/10)), cross-origin browser clients
  ([#11](https://github.com/allsrc/agent-taskbay/issues/11)), runs longer than 50 s
  ([#12](https://github.com/allsrc/agent-taskbay/issues/12)), real-client and schema verification
  ([#13](https://github.com/allsrc/agent-taskbay/issues/13)) and a committed browser E2E suite for forms
  ([#14](https://github.com/allsrc/agent-taskbay/issues/14)). None blocks the next slice.

## Accepted implementation choices

- Distribution: one npm package, `agent-taskbay`, run locally with `npx agent-taskbay` (ADR 0025). The production build uses webpack so it can be
  shipped through npm; Turbopack remains the development bundler.
- Product name: Agent Taskbay (ADR 0024); repository and package slug `agent-taskbay`. Wire and persisted identifiers use the same slug.
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

## Verification evidence

Dated evidence for every completed slice is in [`EVIDENCE.md`](./EVIDENCE.md).
