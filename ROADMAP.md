# a2a-agent-workflow-ui roadmap

This roadmap evolves the current scaffold (catalog → start task → inbox →
task detail, all running against a live agent) into the enterprise
human-in-the-loop console described in `A2A_LITE_CHAT_UI_DESIGN.md` §7
(SpanPlane repo, `docs/a2a-lite-chat-ui-design` branch). That document is the
source of truth for *why*; this file tracks *what's done and what's next*.

## Guiding principles

- Server-mediated, never browser-direct: agent credentials stay server-side.
- A2A's real unit of work is a Task, not a conversation — the inbox, not the
  chat window, is the home view.
- Don't build the harder path speculatively (e.g. token-exchange auth,
  a directory-service-backed registry) until the simpler one is proven.
- Every "kept" feature (sideband, compliance validation, request safety) is
  A2A-spec surface, not observability scope creep.

## Current baseline (shipped)

- Agent/workflow catalog with live Agent Card discovery and skill listing
  (`src/lib/agent-registry.ts`, env-var-backed, behind an `AgentRegistry`
  interface)
- Start-a-task composer that opens a real `message/stream` against the
  agent, server-mediated via `/api/agents/[agentId]/stream`; supports
  text/Markdown/JSON data parts, file attachments, and per-request options
  (`returnImmediately`, `historyLength`, `acceptedOutputModes`,
  `referenceTaskIds`, message/request metadata)
- Message-or-Task responses: a plain Message reply is tracked as a direct
  reply thread; a Task gets a lifecycle view
- Task inbox grouped by A2A's actual lifecycle buckets (needs-my-input /
  in-progress / completed / failed)
- Task detail view: chat thread + `ArtifactGallery`, lifecycle + status
  history, identifiers panel (context/task/message/artifact IDs),
  input-required/auth-required banner, reply composer that continues the same
  `taskId`/`contextId`, same-conversation task list
- Inbox: by-status and by-conversation (`contextId`) views
- Full content-type rendering: text/Markdown/JSON/CSV/images/audio/video/
  PDF/raw files, plus structured and experimental "rich JSON" views
- Sideband: negotiated A2A extension events decoded and rendered
- Request safety: SSRF protections, Agent Card compliance validation,
  request size limits
- Lint + unit tests + production build in CI

Everything above runs, but task state is **browser-local** (Zustand +
`localStorage`) and every request connects to agents as `{ type: "none" }`.
Those two gaps are what block everything past "one person, one browser."

## Phase 1: durable, shared task store

The single biggest gap. Without this, the inbox can't be a manager's view
of a report's task, and nothing survives a lost tab.

### Deliverables
- Task store service (durable, queryable) behind an interface, replacing
  the client-local Zustand store as the source of truth
- Org/team/owner-scoped task visibility (who can see a task, not yet who
  can *act* on it — that's Phase 3's RBAC)
- Webhook receiver for `tasks/pushNotificationConfig/set` + live fan-out
  to connected clients over SSE/WebSocket
- Inbox and task detail read from the server store instead of `localStorage`

### Exit criteria
- Refreshing, or opening the same task from a different browser/device,
  shows the same state.
- A task started by one (test) user is visible to another with access,
  without either having the originating tab open.

## Pending A2A-model UI gaps

Smaller than a phase; not yet built, from the A2A 1.0 request/response model.

- Push notification config in the composer (`taskPushNotificationConfig`) —
  blocked on Phase 1's webhook receiver
- Message `extensions[]` picker (extensions are only auto-negotiated today)
- `tenant` routing field (AgentInterface tenant) on sends
- Explicit `GetTask` refresh / `ListTasks` sync with the agent (state is
  local-only until Phase 1)
- AUTH_REQUIRED has a banner but no actual auth hand-off flow (Phase 2)
- Live agent verification: new flows (input-required reply, file/data parts,
  direct replies) are unit-tested at the event-folding level only; add e2e
  in Phase 6

## Phase 2: auth (design doc §5)

### Deliverables
- **Plane B, service-identity** (client-credentials grant or static API
  key/mTLS) — do this first; it's what lets the UI reach any real
  credential-protected agent at all
- **Plane A**, OIDC login to use the UI (Auth.js generic OIDC provider,
  httpOnly session cookie, optional/off by default)
- **Plane B, user-delegated** (`authorizationCode` flow, PKCE + `state`,
  server-side token exchange), keyed by `(session/user, agent card URL or
  issuer+audience)` — not global
- Encrypted server-side token storage behind an interface

### Exit criteria
- The UI can start a task against an agent that requires a bearer token or
  API key, with the credential never reaching the browser.
- Plane A and Plane B remain independently optional, as designed.

## Phase 3: RBAC and multi-tenancy (§7.2.8, §7.2.10)

### Deliverables
- Org / user / role model
- Which agents or skills a user/team may invoke, enforced server-side
- Task ownership and visibility wired into Phase 1's store (a manager can
  see and act on a task a report started)

### Exit criteria
- A user without a grant for an agent cannot see it in the catalog or act
  on its tasks, even with a direct task URL.

## Phase 4: workflow audit trail (§7.2.9)

### Deliverables
- Who started / approved / rejected a task, and when — task-lifecycle
  scoped, append-light, not SpanPlane's evidence-capture-everything model
- Surfaced on the task detail view, not a separate trace explorer

### Exit criteria
- Every task's approval history is answerable from the audit log alone,
  independent of chat transcript retention.

## Phase 5: structured start forms (§7.2.3)

### Deliverables
- Render a real form when an agent opts into an AgentCard extension that
  advertises an input schema
- Generic text/JSON/file composer remains the fallback (A2A doesn't
  standardize a per-skill JSON Schema, so this is opt-in per agent)

### Exit criteria
- At least one fixture/reference agent with a schema extension gets a real
  form instead of the generic composer, with no behavior change for
  agents that don't advertise one.

## Phase 6: hardening and ops

### Deliverables
- Dockerfile + optional compose
- Playwright e2e for streaming chat flows (the one surface none of the
  prior-art projects in the design doc's survey test)
- CI: dependency review / basic security scanning alongside lint+test+build

### Exit criteria
- `docker compose up` runs the app against a configured agent registry
  with no local Node setup.
- A streaming send/resume/artifact-render round trip is covered by e2e,
  not just unit tests of the content model.

## Priorities

### Now
- Phase 1 (durable task store) — everything else compounds on top of it.
- Phase 2's service-identity slice, since the catalog is currently useless
  against any agent that requires credentials.

### Next
- Phase 2's remaining auth planes (OIDC login, user-delegated).
- Phase 3 (RBAC), once there's a real store and real identities to scope.

### Later
- Phase 4 (audit trail), Phase 5 (structured forms), Phase 6 (hardening/ops).

## Non-goals

(Carried over from design doc §1 — this project is deliberately smaller
than SpanPlane.)

- OpenTelemetry/Phoenix tracing or a trace explorer
- Append-only evidence capture, session ZIP export, compliance/redaction-
  for-audit tooling
- The protocol-operations console (get/list/subscribe/cancel/push-config
  as a testing surface, distinct from Phase 1's webhook receiver which
  exists to drive the inbox, not to expose raw operations)
- TCK/ITK-adjacent conformance tooling
