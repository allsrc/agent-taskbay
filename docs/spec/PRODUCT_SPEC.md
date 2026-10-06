# Product specification

## Product statement

**Agent Taskbay** is the open-source human
operations console for an organization's A2A agent mesh. It lets authorized
people discover agents, start and track long-running work, resolve human
interventions, inspect and reuse artifacts, and understand who decided what.

Its tagline is: **The human operations console for A2A agent workflows.**

It is not a generic chat frontend. Chat is one interaction view over durable
A2A Tasks and Messages.

## Users

- **Operator**: starts tasks, supplies requested input, reviews results, and
  owns assigned work.
- **Reviewer/approver**: makes bounded decisions on proposed actions and needs
  exact context and an audit trail.
- **Manager**: monitors team queues, reassigns work, and tracks overdue items.
- **Agent administrator**: registers trusted agents, configures credentials,
  grants access, and monitors compatibility/health.
- **Platform operator**: deploys, upgrades, backs up, and diagnoses the console.

## Success outcomes

- A task continues to be tracked after every browser disconnects.
- An authorized user sees the same current state from another device.
- Duplicate or replayed remote events do not duplicate messages, artifacts,
  notifications, or decisions.
- Credentials never appear in browser state, logs, wire views, or client-side
  storage.
- The system can answer who initiated, assigned, approved, rejected, canceled,
  or modified a task and when.
- Local development requires no external database server; enterprise uses
  managed PostgreSQL without changing domain or application logic.

## Functional requirements

### Agent catalog

- `AGT-001`: Administrators can register, update, disable, and remove managed
  Agent Card locations; environment-seeded entries remain supported.
- `AGT-002`: The catalog stores discovery snapshots, interfaces, versions,
  tenants, capabilities, skills, modes, extensions, and security schemes.
- `AGT-003`: The system records compliance, signature/trust, and connection
  health separately from the agent's self-description.
- `AGT-004`: Access to agents and skills is organization/team/user scoped.

### A2A tasks and messages

- `TSK-001`: Users can send supported text, Markdown, structured data, URL, and
  file parts with A2A send configuration.
- `TSK-002`: Tasks, Messages, contexts, transitions, and artifacts are durable
  and queryable across users and devices.
- `TSK-003`: The runtime tracks open tasks through streams, authenticated push,
  and reconciliation without requiring a browser connection.
- `TSK-004`: Users can get, refresh, subscribe to, reply to, and cancel tasks
  when the agent and policy allow it.
- `TSK-005`: Direct Message responses remain first-class and are not converted
  into fake A2A Tasks.
- `TSK-006`: Local workflows can link tasks across agents without assuming
  remote task IDs are portable between agents.
- `TSK-007`: A persisted command has a stable message/idempotency identity so
  retries do not silently duplicate work.

### Human intervention

- `HITL-001`: Input-required and auth-required states appear in the responsible
  user's durable queue.
- `HITL-002`: A human can reply, negotiate, reject, or resolve the request using
  the mechanisms supported by the agent.
- `HITL-003`: Approval-grade requests use typed approve, reject, edit,
  request-changes, and delegate decisions with scope, expiry, rationale, and
  proposed-action context.
- `HITL-004`: The approved content is immutably correlated with the attempted
  and observed result.
- `HITL-005`: Work can be assigned, claimed, reassigned, escalated, and given a
  due time independently of the remote task state.
- `HITL-006`: Approval requests can originate from the agent through a reviewed
  extension or recognized in-task pattern, not only from an operator on its behalf.
- `HITL-007`: Expiry and supersession are enforced by workers, not only when a
  reviewer acts, and reviewers and requesters are told when a request closes.
- `HITL-008`: Approval-grade review is available in the console UI with the exact
  proposal, revision history, decision record and delivery result visible, and the
  same review reaches mobile and keyboard users.

### Inbox and notifications

- `INB-001`: Users can query all, active, needs-input, assigned, overdue,
  terminal, and saved views within their authorization scope.
- `INB-002`: Search and filters include agent, skill, owner, team, tenant,
  state, risk, and update time.
- `NTF-001`: Notifications and per-user read state are durable.
- `NTF-002`: Browser and pluggable external channels receive actionable events
  through retryable deliveries.

### Artifacts and rendering

- `ART-001`: Artifact metadata is durable and binary content is accessed
  through a replaceable artifact store.
- `ART-002`: The UI deterministically renders supported media without executing
  arbitrary agent-supplied code.
- `ART-003`: Remote content is subject to network, media, size, download, and
  retention policy before browser access.

### Identity, credentials, and authorization

- `SEC-001`: Plane A authenticates users through a local development adapter or
  production OIDC session.
- `SEC-002`: Plane B authenticates to each agent using server-side API key,
  bearer, OAuth client credentials, mTLS, or user-delegated OAuth credentials.
- `SEC-003`: Secrets are encrypted, scoped, redacted, rotatable, and never sent
  to the browser.
- `SEC-004`: Server-side policy protects organizations, agents, skills, tasks,
  decisions, assignments, credentials, and administrative operations.
- `SEC-005`: Outbound URLs, redirects, DNS resolution, Agent Cards, webhooks,
  and artifacts cross explicit trust boundaries.

### Audit and administration

- `AUD-001`: Security- and workflow-relevant user/system actions create an
  append-only audit record with actor, organization, action, target, time, and
  safe structured detail.
- `AUD-002`: Audit records are distinct from raw A2A protocol events and chat
  transcript retention.
- `ADM-001`: Administrators can inspect agent health, protocol compatibility,
  trust status, credential status, and failed background work.

### Interoperability

- `INT-001`: A2A 1.0 is canonical; supported v0.3 interoperability is explicit
  and tested rather than accidental.
- `INT-002`: Extension negotiation remains URI-based and opt-in.
- `INT-003`: Structured forms and A2UI can enrich input without replacing the
  generic A2A composer.
- `INT-004`: An optional AG-UI adapter may expose compatible agents to richer
  user-facing runtimes without changing durable task semantics.

## Quality requirements

- `REL-001`: At-least-once inputs are processed idempotently.
- `REL-002`: A lost stream or live-update signal cannot permanently lose task
  state; reconciliation restores convergence.
- `REL-003`: Projection state can be rebuilt from retained protocol events.
- `PERF-001`: Inbox reads use indexed projections and never scan raw event
  payloads.
- `SCL-001`: Web and worker instances can scale horizontally using leases and
  shared durable stores.
- `OPS-001`: Local, Docker/demo, and enterprise deployment profiles are
  supported and documented.
- `OPS-002`: Migrations, backup, restore, health, and recovery are testable.
- `OPS-003`: The published package starts the local profile with one command and no prior setup. It binds only to loopback while
  development identity is active, keeps its secrets out of logs and the browser, and refuses a second owner of the same data
  directory.
- `DX-001`: A contributor can go from a clean clone to a running console, sample agents and the checks using only repository
  documentation, with no database server and no `.env` file.
- `OSS-001`: The repository carries the license and notices, contribution, conduct and security policies, issue and pull request
  templates, a changelog, and an automated release path with npm provenance.
- `TST-001`: Core repositories run against PGlite and PostgreSQL.
- `TST-002`: Streaming, reconnect, duplicate delivery, input-required,
  auth-required, cancellation, and artifact assembly have end-to-end coverage.
- `ACC-001`: Core workflows remain keyboard accessible and responsive.

## Non-goals

- Implementing an agent reasoning framework or model runtime.
- Replacing the orchestrator inside an existing agent mesh.
- Exposing hidden internal delegation that A2A intentionally keeps opaque.
- A generic BPMN/workflow designer.
- A protocol conformance test suite or raw-operation workbench.
- A full OpenTelemetry/Phoenix trace explorer.
- Executing arbitrary agent-generated JavaScript or HTML.
- Storing large binary artifacts in relational database rows.

## Product boundaries

- Protocol inspection is included only where it helps operate a task.
- Approval is a bounded application decision; `AUTH_REQUIRED` alone is never
  treated as approval.
- A2UI/AG-UI are complementary interfaces, not replacements for the durable
  A2A task record.
- External workflow engines may integrate through adapters, but are not a
  required dependency for the core product.
