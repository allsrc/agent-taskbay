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

**Status:** Complete; Slices 2.1–2.7 and all exit criteria verified on 2026-10-03 in `STATUS.md`.

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

- [x] Publish application SSE as a freshness signal over durable state.

Publish committed projection changes through durable retryable outbox intent
and a replaceable freshness adapter. Browser consumers re-query organization-
scoped projections after signals/reconnect. Verify browser disconnect, missed
signals, duplicate signal delivery and embedded/external worker profiles. Keep
remote observation owned by workers. Do not remove remaining browser persistence
in this slice.

### Slice 2.7: browser persistence authority removal

- [x] Remove task content and notification authority from browser persistence.

Chat, flows and current alerts load organization-scoped server projections,
including direct Messages, into a disposable tab cache. Retire legacy task/read
storage without importing it. Pending user turns remain composer-only and
protocol wire events never become visible task content. Verify clean-session
and reload recovery, pagination, failed/racing reads, live updates, both database
contracts and the complete Phase 2 exit criteria. Notification read marks are
session presentation state; durable per-user notifications/read state and
channels remain Phase 4 deliverables.

### Exit criteria

- [x] A task started in one browser continues after every browser closes.
- [x] Restarting web and worker processes converges to the remote task state.
- [x] Duplicate and out-of-order test deliveries do not duplicate visible content.
- [x] A missed SSE/live signal is recovered by re-querying durable state.
- [x] Streaming/reconnect, input-required, cancellation, and artifact assembly pass
  end-to-end against reference agents.

Requirements: `TSK-001..007`, `HITL-001..002`, `REL-001..003`, `SCL-001`,
`TST-002`.

## Phase 3 — identity and security

**Status:** Complete; combined Slices 3.1 and 3.2 and all exit criteria verified
on 2026-10-03 in `STATUS.md`.

### Combined Slice 3.1: Plane A identity and organization access

Related work is implemented together per the user's execution preference:
library-backed development/OIDC adapters, persistent users/external identities/
memberships/sessions, organization role checks on all application routes,
administrative agent registration, transactional safe security audit and threat
model/regression coverage. Verify both database profiles, signed-token failures,
real production HTTP login/replay/logout, organization isolation and the full
existing runtime gate. This combines related deliverables without claiming
the scoped-grant or Plane B security exit criteria.

### Combined Slice 3.2: Plane B credentials and scoped security

The encrypted vault/service credential path is implemented together with
team/agent/skill policy, network/artifact/trust controls and protected-agent/
secret-disclosure regressions. Trusted protocol/cryptography libraries stay
behind application ports.

### Deliverables

- [x] Add development identity and production OIDC session adapters.
- [x] Add encrypted `CredentialVault` and agent credential bindings.
- [x] Implement API key, bearer, OAuth client credentials, and mTLS service
  identity. The service baseline is proven; user-delegated OAuth consent/refresh
  remains the explicitly conditional follow-up described in ADR 0014, not an
  implemented profile. Plane A tokens are never reused for Plane B.
- [x] Add organization, user, team, membership, role, and scoped grants.
- [x] Enforce policies on every read, command, and administration route.
  Slices 3.1/3.2 verify authentication, organization scope, baseline roles and
  agent/skill grant policy, including direct/compatibility routes and artifacts.
- [x] Make agent registration administrative.
- [x] Add target allowlists, connection-bound DNS policy, webhook validation,
  rate limiting, and safe artifact delivery.
- [x] Verify and display Agent Card signatures/trust when advertised.
- [x] Maintain a repository threat model and security regression tests.

All four service profiles use real TLS fixtures. The secure HTTP gateway deliberately
rejects gRPC until its adapter can bind DNS validation to the socket. Pre-upgrade
artifacts need archive-backed projection rebuilding for trusted references. These
limits and the delegated-authentication follow-up are explicit in ADR 0014.

### Pending conditional follow-up

- [ ] Review and implement user-delegated OAuth consent, refresh/revocation and
  membership-bound worker credentials. Deferred by agreement on 2026-10-03 and
  tracked in [GitHub issue #1](https://github.com/shashikanth-gs/a2a-ops/issues/1).
  This extension is separate from the completed service identity exit criteria.

### Exit criteria (verified 2026-10-03)

- A protected reference agent works without credentials reaching the browser.
- A user lacking an agent/skill grant cannot discover or invoke it, including
  through direct URLs.
- Cross-organization task and artifact access tests fail closed.
- Secrets are absent from browser storage, logs, errors, wire views, and audit.

Requirements: `AGT-004`, `SEC-001..005`, `AUD-001`, `SCL-001`.

## Phase 4 — approval-grade human intervention

**Status:** In progress; Slices 4.1, 4.1b and 4.3 verified 2026-10-05.

### Deliverables

- [x] Model typed decision requests and revisions.
- [x] Implement approve, reject, edit, request-changes, and delegate actions.
- [x] Record scope, expiry, rationale, proposed action, reviewer, and policy.
- [x] Correlate the approved revision to the dispatched and observed result.
- [x] Slice 4.1b: approval review UI (queue, review page with approve, edit,
  reject, request-changes and delegate, task-page integration, navigation badge).
- [ ] Add task claiming, assignment, due times, escalation, and internal notes.
  Assignment is limited to an initial assignee and `delegate` so far; the review page
  has no claim, due-time, escalation or notes panels yet (slice 4.2).
- [x] Run decision expiry from a worker and supersede open requests when their task
  finishes (`HITL-007`, slice 4.3). Notifying requesters and reviewers when a request
  closes remains with the notification work below.
- [x] Publish decision changes through the existing freshness outbox and refresh
  observed execution outcomes from the worker (slice 4.3). The approvals pages now
  update on the shared freshness signal and keep the five-second poll only as the
  missed-signal fallback, as the Tasks views do.
- [ ] Add immutable workflow audit views over the decision, assignment and audit records.
- [ ] Persist notifications/read state and add browser plus one external
  notification channel behind adapters, including a notification when a request opens,
  is assigned, is about to expire, expires or is superseded. Replace the approvals
  badge's polling with this durable state.
- [ ] Agent-originated approval requests through a reviewed extension or recognized
  in-task pattern (`HITL-006`); agents currently cannot ask for approval themselves.
- [ ] Additional typed action kinds beyond `send_message`, each with a server
  variant, an execution adapter and an entry in the UI action-renderer registry.
- [ ] Browser-level UI tests in CI for the approval flows; slice 4.1b verified them
  manually with a scripted browser run that is not yet part of the quality gate.

### Exit criteria

- The audit record alone identifies who decided exactly what and when.
- Replayed or repeated decisions do not execute twice.
- An expired or superseded approval cannot authorize a new action.
- Assigned input/approval work reaches the responsible user's durable queue.

Requirements: `HITL-001..008`, `NTF-001..002`, `AUD-001..002`.

## Phase 5 — operator experience

**Status:** Planned.

### Deliverables

- [ ] Global authorized inbox across agents and teams. Fold the standalone Approvals
  queue (slice 4.1b) into it, reusing the review page as the detail view and keeping
  approvals filterable by status, risk, assignee and expiry.
- [ ] Saved views, full-text search, advanced filters, and bulk triage.
- [ ] SLA, overdue, escalation, and failure indicators, including approvals nearing
  expiry and executions whose delivery outcome is unknown.
- [ ] Bulk approval actions that still require a per-item rationale and the exact
  revision each reviewer saw.
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
- [ ] Render structured and A2UI proposals inside the approval review page through the
  action-renderer registry, with edit-before-approve for structured actions.
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
- [ ] Run the PostgreSQL and browser-level suites against the supported PostgreSQL
  version in CI, including the approval flows.
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
