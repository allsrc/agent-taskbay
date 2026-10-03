# Detailed implementation phases

Checkboxes describe repository state, not intent. Update them only with
verification evidence in `STATUS.md`.

## Phase 0 — specification baseline

**Status:** Complete

### Deliverables

- [x] Product requirements and stable requirement IDs.
- [x] Target modular-monolith and worker architecture.
- [x] Persistent identity and data-model invariants.
- [x] Database, event-ingestion, identity, runtime, and auth ADRs.
- [x] Phase order, exit criteria, and resumption protocol.
- [x] Project instructions that resolve “next phase” from repository state.

### Exit criteria

- [x] A new contributor can identify the active phase without chat history.
- [x] Storage, identity, event, deployment, and security boundaries have an
  accepted in-repository decision.
- [x] The pre-phase application baseline passes lint, unit tests, build, and
  dependency audit.

Requirements: all, as planning coverage.

## Phase 1 — persistence foundation

**Status:** Complete; exit criteria verified on 2026-10-03 in `STATUS.md`.

### Slice 1.1: database bootstrap

- [x] Add MikroORM core, PostgreSQL, and PGlite drivers at compatible versions.
- [x] Add environment-validated database configuration with PGlite as the
  zero-install local default and PostgreSQL by URL.
- [x] Add request/job-scoped EntityManager helpers.
- [x] Add migration and schema-check commands.
- [x] Add CI repository tests against PGlite and PostgreSQL.

### Slice 1.2: initial model and ports

- [x] Implement `Organization`, `Agent`, `AgentCardSnapshot`, `Task`,
  `TaskEvent`, and `OutboxMessage` persistence.
- [x] Implement narrow repository ports in the application layer.
- [x] Create a default local organization bootstrap.
- [x] Enforce `(agentId, tenant, remoteTaskId)` task identity.

### Slice 1.3: durable registry

- [x] Replace the JSON-file managed-agent registry with a database adapter.
- [x] Preserve environment-seeded non-removable entries.
- [x] Persist discovery snapshots and card compliance results.
- [x] Migrate existing managed registry entries idempotently when present.

### Slice 1.4: first durable task read path

- [x] Persist task snapshots/events produced by the existing stream path.
- [x] Add organization-scoped task list/detail query services and APIs.
- [x] Change Tasks views to read server state while retaining the existing
  browser stream as a temporary writer.
- [x] Add restart/recovery and remote-ID collision tests.

### Exit criteria

- [x] Agents and observed tasks survive application restart without browser
  `localStorage` as the authoritative source.
- [x] The same durable task is visible from two clean browser sessions.
- [x] Local setup starts with PGlite and no external database process.
- [x] The repository contract suite passes against PGlite and PostgreSQL.
- [x] Migrations create a clean database and upgrade the immediately previous test
  schema.

Requirements: `AGT-001..003`, `TSK-002`, `REL-001`, `PERF-001`, `OPS-001`,
`TST-001`.

## Phase 2 — durable task runtime

**Status:** In progress; Slices 2.1–2.5 verified with Phase 1 prerequisites complete.

### Slice 2.1: durable command dispatch

- [x] Persist commands with stable message/idempotency IDs.
- [x] Dispatch commands through the transactional outbox.

This slice persists command intent and its outbox record atomically, then
dispatches with durable delivery state and retry behavior. Verify stable IDs,
duplicate submissions, restart recovery, and organization scope before moving
long-lived streams to workers in the next slice.

### Slice 2.2: worker-owned subscriptions

- [x] Move long-lived A2A streams and resubscription into a worker entry point.

Persist subscription intent and leases, reconnect outside browser requests,
and retain server ingestion as the authority. Verify continued observation
after all browsers close, worker restart, input-required and artifact updates.
Use the embedded PGlite owner or separate PostgreSQL workers per ADR 0007.

### Slice 2.3: authenticated push delivery

- [x] Implement authenticated webhook receipt and push-config lifecycle.

Build authenticated, expected-task-scoped webhook receipt and durable push
registration/lifecycle through the gateway and worker ports. Route deliveries
through common ingestion and verify duplicate delivery, invalid authentication,
organization/agent/tenant scope, and restart recovery. Do not begin reconciliation
or projection rebuild in the same slice.

### Slice 2.4: task reconciliation and sync cursors

- [x] Implement `GetTask`/`ListTasks` reconciliation and sync cursors.

Recover missed updates and uncertain observations through worker-owned reads,
with durable scheduling and organization/agent/tenant-scoped cursors. Route
snapshots through common ingestion. Verify missed-event recovery, worker restart,
unsupported streaming peers and scoped remote-ID collisions. Do not resend
uncertain commands automatically or begin projection rebuild/application SSE
in this slice.

- [x] Send all sources through one idempotent ingestion transaction.

### Slice 2.5: versioned projections and rebuild

- [x] Version and rebuild task/message/artifact projections.

Replace the transitional content projection with versioned task/message/artifact
projections behind existing query and ingestion ports. Rebuild from retained
protocol events, including original binary event archives. Verify deterministic
rebuild, cross-source duplicates, out-of-order deliveries, artifact assembly,
restart and organization/agent/tenant isolation on PGlite and PostgreSQL. Keep
reads available during rebuild and record projection-version migration evidence.
Do not begin application freshness SSE or browser-cache authority removal in
this slice.

### Slice 2.6: application SSE freshness signals

- [ ] Publish application SSE as a freshness signal over durable state.

Publish committed projection changes through durable retryable outbox intent
and a replaceable freshness adapter. Browser consumers re-query organization-
scoped projections after signals/reconnect. Verify browser disconnect, missed
signals, duplicate signal delivery and embedded/external worker profiles. Keep
remote observation owned by workers. Do not remove remaining browser persistence
in this slice.

### Remaining deliverables

- [ ] Remove task content and notification authority from browser persistence.

### Exit criteria

- A task started in one browser continues after every browser closes.
- Restarting web and worker processes converges to the remote task state.
- Duplicate and out-of-order test deliveries do not duplicate visible content.
- A missed SSE/live signal is recovered by re-querying durable state.
- Streaming/reconnect, input-required, cancellation, and artifact assembly pass
  end-to-end against reference agents.

Requirements: `TSK-001..007`, `HITL-001..002`, `REL-001..003`, `SCL-001`,
`TST-002`.

## Phase 3 — identity and security

**Status:** Planned; depends on durable organization/task storage.

### Deliverables

- [ ] Add development identity and production OIDC session adapters.
- [ ] Add encrypted `CredentialVault` and agent credential bindings.
- [ ] Implement API key, bearer, OAuth client credentials, and mTLS service
  identity; add user-delegated OAuth only after the service path is proven.
- [ ] Add organization, user, team, membership, role, and scoped grants.
- [ ] Enforce policies on every read, command, and administration route.
- [ ] Make agent registration administrative.
- [ ] Add target allowlists, connection-bound DNS policy, webhook validation,
  rate limiting, and safe artifact delivery.
- [ ] Verify and display Agent Card signatures/trust when advertised.
- [ ] Maintain a repository threat model and security regression tests.

### Exit criteria

- A protected reference agent works without credentials reaching the browser.
- A user lacking an agent/skill grant cannot discover or invoke it, including
  through direct URLs.
- Cross-organization task and artifact access tests fail closed.
- Secrets are absent from browser storage, logs, errors, wire views, and audit.

Requirements: `AGT-004`, `SEC-001..005`, `AUD-001`, `SCL-001`.

## Phase 4 — approval-grade human intervention

**Status:** Planned; depends on identity and durable runtime.

### Deliverables

- [ ] Model typed decision requests and revisions.
- [ ] Implement approve, reject, edit, request-changes, and delegate actions.
- [ ] Record scope, expiry, rationale, proposed action, reviewer, and policy.
- [ ] Correlate the approved revision to the dispatched and observed result.
- [ ] Add task claiming, assignment, due times, escalation, and internal notes.
- [ ] Add immutable workflow audit views.
- [ ] Persist notifications/read state and add browser plus one external
  notification channel behind adapters.

### Exit criteria

- The audit record alone identifies who decided exactly what and when.
- Replayed or repeated decisions do not execute twice.
- An expired or superseded approval cannot authorize a new action.
- Assigned input/approval work reaches the responsible user's durable queue.

Requirements: `HITL-001..005`, `NTF-001..002`, `AUD-001..002`.

## Phase 5 — operator experience

**Status:** Planned.

### Deliverables

- [ ] Global authorized inbox across agents and teams.
- [ ] Saved views, full-text search, advanced filters, and bulk triage.
- [ ] SLA, overdue, escalation, and failure indicators.
- [ ] Agent/skill health and compatibility administration.
- [ ] Typed local workflow links and “use artifact as input to” actions.
- [ ] Durable per-user preferences and notification controls.

### Exit criteria

- Operators can manage a representative multi-agent/team workload without
  navigating task-by-task.
- Inbox queries meet the documented performance budget using indexed
  projections.
- The UI never claims visibility into unobserved internal agent delegation.

Requirements: `INB-001..002`, `TSK-006`, `HITL-005`, `ADM-001`, `PERF-001`,
`ACC-001`.

## Phase 6 — rich interoperability

**Status:** Planned.

### Deliverables

- [ ] Structured start/input forms through an advertised schema extension.
- [ ] Safe A2UI renderer with an explicit component allowlist.
- [ ] Optional AG-UI adapter where it adds richer user interaction.
- [ ] Extension plugin contract and compatibility fixtures.
- [ ] Preserve the generic A2A composer and durable task model as fallbacks.

### Exit criteria

- At least one reference agent renders a structured form and one A2UI surface.
- Unrecognized schemas/extensions fall back safely.
- Generated UI cannot execute arbitrary code or bypass authorization.

Requirements: `ART-002`, `INT-002..004`, `ACC-001`.

## Phase 7 — enterprise hardening

**Status:** Planned.

### Deliverables

- [ ] Docker/demo profile with PostgreSQL and fixture agents.
- [ ] Multi-replica web and worker deployment with shared leases/live bus.
- [ ] S3 lifecycle, malware/content policy hooks, and retention controls.
- [ ] KMS/external-secret adapter and rotation procedures.
- [ ] Backup, restore, point-in-time recovery, and migration runbooks.
- [ ] Load, soak, failover, chaos, and recovery testing.
- [ ] Dependency review, SAST, container scanning, and release provenance.
- [ ] Data deletion, retention, export, and administrative controls.
- [ ] SCIM and additional enterprise identity features only when required.

### Exit criteria

- A documented production deployment survives a web or worker replica loss.
- Backup restore and upgrade rollback are exercised, not merely documented.
- Security and dependency gates run in CI.
- Operational SLOs and alert thresholds are defined and observed in a load
  environment.

Requirements: `ART-001..003`, `OPS-001..002`, `SCL-001`, `SEC-003..005`,
`TST-001..002`.
