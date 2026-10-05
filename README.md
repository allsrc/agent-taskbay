# A2A Ops

**The human operations console for A2A agent workflows.**

Discover agents, operate durable tasks, handle human approvals, and audit work
across an Agent2Agent (A2A) agent mesh. A2A Ops supports real-time task
execution and full multi-modal message and artifact rendering (text, Markdown,
JSON, files, images, audio, video, and PDF).

Built on the official [`@a2a-js/sdk`](https://www.npmjs.com/package/@a2a-js/sdk).

This is not a single-agent chat demo or a protocol testbench. It's the human
entry point into an org's *existing* A2A agent mesh: A2A already handles
agent-to-agent delegation invisibly; this is the missing human half of
human-in-the-loop — a place to start a process, get pulled back in exactly
when an agent needs a decision, and see it through to done.

## Status

Phase 1 is complete: the agent registry and observed task history persist in
PGlite or PostgreSQL, and Tasks views read shared server state. Phase 2 is also
complete, with
durable commands, worker subscriptions, authenticated push, reconciliation,
rebuildable projections and application freshness SSE. Tracking continues after
browsers close and reconnects after worker restart. Chat, orchestration and alerts
reload durable server projections in a fresh browser. Phase 3 now adds
library-backed OIDC/development identity, membership-bound sessions, organization
roles and administrative catalog controls. Scoped grants, service credentials
and approval-grade workflow audit remain planned. See
**What's not built yet** below.

## Project specification

This repository uses spec-driven development so implementation can continue
without relying on prior chat context:

- [`docs/spec/README.md`](./docs/spec/README.md) — how the specifications are
  organized and how to resume work.
- [`docs/spec/PRODUCT_SPEC.md`](./docs/spec/PRODUCT_SPEC.md) — requirements,
  users, invariants, and non-goals.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the target production architecture.
- [`docs/spec/DATA_MODEL.md`](./docs/spec/DATA_MODEL.md) — persistent identity,
  event, projection, and tenancy model.
- [`ROADMAP.md`](./ROADMAP.md) and
  [`docs/spec/PHASES.md`](./docs/spec/PHASES.md) — phase summary and detailed
  acceptance criteria.
- [`docs/spec/STATUS.md`](./docs/spec/STATUS.md) — current phase, verified
  baseline, and next executable slice.
- [`docs/adr`](./docs/adr) — accepted architectural decisions.

The local database target is **PGlite** (embedded PostgreSQL); production uses
PostgreSQL. SQLite can be supplied as an optional adapter but is not the
canonical schema or migration target.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  UI (Next.js)                                                │
│  ├─ Agent/workflow catalog   (browse what can be started)    │
│  ├─ Task inbox               (mine / needs-my-input / done)  │
│  └─ Task detail view         (chat thread + artifacts)       │
├─────────────────────────────────────────────────────────────┤
│  API layer                                                    │
│  ├─ Gateway (src/lib/gateway.ts → @a2a-js/sdk)                │
│  ├─ Task query/observation services (durable, queryable)     │
│  ├─ Webhook receiver           (authenticated task push)      │
│  ├─ Freshness SSE             (outbox → projection reads)    │
│  └─ Agent registry service     (catalog, pluggable)           │
├─────────────────────────────────────────────────────────────┤
│  Data layer                                                    │
│  ├─ Observed tasks/events (organization-scoped)             │
│  ├─ Org / users / sessions / baseline roles                  │
│  ├─ Per-agent auth tokens (server-side, encrypted)   [TODO]   │
│  └─ Workflow audit log                               [TODO]   │
└─────────────────────────────────────────────────────────────┘
```

Server-mediated, not browser-direct: Next.js API routes proxy to agents via
`src/lib/gateway.ts`, so agent credentials never reach the browser. The
gateway, content model, and rendering stack (`src/lib`, `src/components`,
`src/server/sideband`) are adapted from
[SpanPlane](https://github.com/shashikanth-gs/spanplane) (Apache-2.0 — see
`NOTICE`), which already has a mature, spec-correct implementation of A2A
discovery, streaming, content-type rendering, and sideband decoding.

## What's built

- **Agents** (`/agents`) — searchable list of registered agents with live
  Agent Card discovery; the detail pane shows capabilities, interfaces
  (bindings + tenant), skills, security schemes and input/output modes. A
  three-step **Connect agent** flow (Agent Card URL → advertised security →
  connect) registers new ones. Backed by `src/lib/agent-registry.ts`
  (PGlite/PostgreSQL, behind an `AgentRegistry` interface). Registered-agent
  catalog and detail discovery persist raw/normalized cards and compliance
  snapshots. Environment-seeded entries remain non-removable.
- **Chat** (`/chat`, `/chat/[key]`) — one conversation (`contextId`), many
  tasks, in a single timeline: Message replies as bubbles, each Task as a card
  (status steps, cancel), `INPUT_REQUIRED` / `AUTH_REQUIRED` prompts (with
  quick-reply buttons when the agent sends options), and streaming artifacts.
  The composer builds a real A2A message: text or Markdown (★ = preferred by the
  card) plus file / URL / structured-data parts, checked against the card's
  input modes. A right-hand panel (a sheet on small screens) holds
  **`{ } Wire`**, the A2A exchange as a numbered request/response sequence with
  expandable payloads, and **Options** (`returnImmediately`, `historyLength`,
  `acceptedOutputModes`, `referenceTaskIds`). A "Send to" selector replies to a waiting task, follows
  up on a running one (same `taskId`), or starts a new task in the same context.
- **Tasks** (`/tasks`, `/tasks/[taskId]`) — filterable list (All / Active /
  Needs you / Done) and a detail view: status timeline, history, artifacts,
  identifiers, `SubscribeToTask`, `CancelTask`, open in chat. List and detail
  read the database, re-query on freshness signals, reconnect, every five seconds and on focus, and use local
  UUID URLs. Observed streams, blocking replies, and cancellation responses
  atomically persist events and task projections. Remote IDs are scoped by
  agent and tenant. Binary output is stored outside the database and offered
  as an attachment download.
- **Orchestration** (`/flows`) — tasks of a context and the
  `referenceTaskIds` links between them.
- **Notifications** (`/notifications`) — input requests, finished tasks and
  ready artifacts derived from task streams, with read state and an unread badge.
- **AG-UI adapter** (optional, `A2A_AGUI_ENABLED=true`) — `POST /api/agents/{agentId}/ag-ui`
  accepts an AG-UI `RunAgentInput` and streams AG-UI events for one durable agent task.
  Input requests end the run with an interrupt (carrying the agent's form schema when it
  advertises the structured-form extension); a `resume` entry answers or abandons it.
  Same-origin, authenticated callers only; see ADR 0021 for the mapping and limits.
- **Settings** (`/settings`) — request defaults, extension URIs and a
  credentials overview.
- **Design system** — shadcn/ui + Tailwind v4 tokens for the allsrc.dev theme
  (light and dark, following the system by default with a manual switch:
  periwinkle + coral on #FAF9F6 / #141414, JetBrains Mono + Instrument Sans), Radix primitives and `motion` for transitions.
  Responsive: sidebar on desktop, bottom nav on mobile.
- **Content rendering** — text/Markdown/JSON/CSV/images/audio/video/PDF/raw
  files, structured + experimental "rich JSON" views, all deterministic
  (never model-guessed).
- **Sideband** — the A2A extension mechanism is negotiated and decoded
  (`src/server/sideband`), kept as a light execution-context indicator, not
  a trace explorer.
- **Request safety** — SSRF protections (`src/lib/url-safety.ts`,
  `src/lib/safe-fetch.ts`), Agent Card compliance validation
  (`src/lib/compliance.ts`), request size limits (`src/lib/request-guard.ts`).

## What's not built yet

Worker streaming requires advertised support; GetTask polling recovers known
work when streaming or push is unavailable. Chat, orchestration and current
alerts load server projections, including direct Message replies, without
browser history. Notification read marks are session-only; durable per-user
notifications/read state and external channels remain Phase 4 work. Encrypted Plane B service credentials and team/agent/skill grants are implemented.
Typed approvals, structured start forms and a workflow audit trail remain planned.
User-delegated OAuth consent/refresh is a conditional follow-up to the service baseline. Plane A login, membership-bound sessions, baseline
organization roles and safe security audit facts are implemented.
[`docs/spec/STATUS.md`](./docs/spec/STATUS.md) identifies the next executable
slice, with phase deliverables in [`ROADMAP.md`](./ROADMAP.md).

## Getting started

```bash
npm install
cp .env.example .env.local   # PGlite is the zero-install database default
npm run db:migrate           # apply the durable schema baseline
npm run dev                  # http://localhost:3002
```

Set `A2A_DATABASE_PROFILE=postgresql` and `A2A_DATABASE_URL` to use a PostgreSQL
server instead. `A2A_PGLITE_DATA_DIR` overrides the default `.data/pglite`
directory. Database credentials are server-only configuration.

Binary output and original events containing inline bytes are archived under
`.data/artifacts` (override with `A2A_ARTIFACT_DATA_DIR`). Back up this directory
alongside the database. The initial adapter limits each object to 16 MiB and
serves downloads as attachments subject to current task grants. Remote artifact
media is not automatically loaded.

Initial sends and cancellations persist command intent before dispatch. The
local default starts embedded command, subscription, push, reconciliation, freshness and approval-sweep workers in the Next.js
Node server; use a
long-running server for this profile. For separate workers, configure
PostgreSQL and `A2A_COMMAND_WORKER_MODE=external`, then run
`npm run worker:tasks` alongside the web server (`worker:commands` is an alias). Both processes need the
same database, artifact directory, and server configuration. The worker
requires dev dependencies (`tsx`) in this initial packaging.

Scripts can submit `POST /api/agents/<local-agent-id>/commands` with an
`Idempotency-Key` header and a send body (`text`/`parts`, optional tenant,
messageId, taskId, contextId, and config), or `action: "cancelTask"` plus
taskId. The API returns 202 and a local command ID; poll
`GET /api/commands/<id>` for status/result. Repeat the same key and content to
recover the original operation; changed content returns 409. Command input is
archived outside relational rows. Discovery failures retry up to three times;
uncertain remote outcomes and expired attempts require investigation and are
never automatically resent.

Compatibility send/cancel routes wait for the durable result. Initial sends
use A2A SendMessage, defaulting to returnImmediately unless config explicitly
sets it. Active task responses atomically create subscription intent. Workers
maintain up to eight concurrent streams, renew leases, reconnect with backoff,
and ingest independently of browsers. Input/auth-required and terminal states
stop observation; an active reply re-arms it. The browser stream reads committed
snapshots and diagnostic events for up to 50 seconds and may reconnect only to known agent/tenant tasks.
Closing it stops the local view while background tracking continues. After a
crash, another worker resumes when the 15-second lease expires.

Existing `.data/agents.json` entries (or `A2A_DATA_DIR/agents.json`) are
automatically imported on first registry access after migrations. The legacy
file is kept unchanged. Imports are repeatable and preserve removed entries as
disabled database records, so restarting cannot restore them. Explicitly
registering a removed URL re-enables its original UUID. Old URL-hash agent
links continue to resolve; new catalog entries expose durable local UUIDs.
Environment-only agents disappear from the active catalog when removed from
`A2A_REGISTERED_AGENTS`; their stored history remains intact.

```bash
npm run lint
npm run test
npm run test:db
npm run db:schema:check
npm run build
npm run test:http # production build required; isolated fixture and restart test
npm run check   # full local quality gate
```

`npm run check` includes the production HTTP test. Database contract tests
always exercise PGlite; set `A2A_TEST_POSTGRES_URL` to exercise PostgreSQL too,
as CI does. The HTTP test uses fresh PGlite and local fixture agents, verifies
commands and observation after browser disconnect, duplicate artifact replay,
input/auth-required prompts, stream reconnect and recovery after killing the
actual database owner/worker, then also
tests a separate PostgreSQL worker when the test URL is set. That test account
needs permission to create/drop its temporary test database.

To enable task push, configure `A2A_PUSH_CALLBACK_ORIGIN` as the console's
externally reachable HTTPS origin and `A2A_PUSH_SIGNING_KEY` as a random 32-byte
key encoded in 64 hexadecimal characters. Both the web and task workers need
the same values. Push stays disabled when the origin is unset. Local loopback
HTTP requires `A2A_PUSH_ALLOW_LOOPBACK_HTTP=true` explicitly.

Workers register existing and newly ingested nonterminal tasks with peers that
advertise push support. The callback is
`POST /api/webhooks/a2a/<registration UUID>`, authenticated by a single-purpose
Bearer credential generated on the server. It accepts canonical A2A 1.0
`StreamResponse` events (`application/a2a+json` or `application/json`) and
explicit v0.3 full Task snapshots. Every callback validates the expected task,
tenant and context; duplicate callbacks commit once. Binary parts use the
ArtifactStore. A durable limit allows 120 authenticated requests per registration
per minute; excess requests return 429 with Retry-After. Invalid authentication
returns 401 before reading the body, invalid payloads return 400, and foreign
routing identity returns 409. Successful receipt returns 204 after commit.

Push registrations survive web/worker restart, retain input/auth-required tasks,
and are deleted on terminal state or agent disablement. Lost create responses
recover through GetConfig using the same ID. Config IDs must be honored by the
peer. Peers without push support stop with a safe operational error; streaming
continues independently where supported. For append chunks, an optional stable
`X-A2A-Delivery-ID` distinguishes identical bytes while preserving retry
idempotency. Without it, identical webhook chunks within a turn collapse; prefer
complete artifact snapshots. Versioned projection rebuild and reconciliation
provide cross-source convergence within the documented identity limits.

Keep the signing key with server secrets and backups. Changing it invalidates
old callback credentials. Before rotation or disabling push, stop workers and
remove old remote configs and their local registrations, then configure all
processes consistently and resume. Managed vault/rotation controls are described in the service identity runbook.
Webhook credential rotation remains a separate lifecycle from agent vault bindings.

## User identity and sign-in

`npm run dev` defaults to a clearly labeled local development administrator.
Apply migrations with the PGlite web process stopped. A production-built trusted
local demo also requires `A2A_AUTH_MODE=development` and
`A2A_ALLOW_DEVELOPMENT_AUTH=true`. Production otherwise requires complete OIDC
configuration and fails closed. See `.env.example` for the server-only variables.

Configure an HTTPS OIDC issuer, client ID/secret, canonical external HTTPS origin,
organization slug and a separate 32-byte flow key (64 hex characters). Register
`https://YOUR_ORIGIN/api/auth/callback` at the provider. The initial profile uses
authorization code, S256 PKCE and RS256/JWKS validation through `openid-client`;
`jose` encrypts temporary server flow state. Cookies are Secure, HttpOnly,
host-only and SameSite=Lax. Terminate public HTTPS at a trusted proxy. Provider
tokens are discarded after validation; no Plane B credential is established by
signing in.

Provision the exact provider subject server-side before login:

```sh
npm run auth:provision -- --issuer https://YOUR_ISSUER --subject EXACT_SUBJECT \
  --organization YOUR_ORG_SLUG --name "Operator name" --role admin
```

For PGlite, stop web first and add `--offline-pglite`. PostgreSQL provisioning can
run online. Re-provisioning a membership updates its role/enabled state; it does
not re-enable a disabled global user. Membership and user `enabled` fields can
be managed by a trusted database operator pending scoped administrative APIs.
The only roles currently supported are `admin`, `operator`, and `viewer`.
Provider email, role and organization claims do not grant access. The configured
organization slug chooses the membership at login; browser selectors are ignored.

Admins manage the agent catalog, operators submit work, and viewers read their
explicitly granted organization data. Members require an agent/skill grant;
admins configure teams and grants in Settings. Service credentials are provisioned
through a server-only CLI and never returned to the browser. Authentication covers every application API, including
compatibility routes, command status, task content, SSE and binary downloads.
Webhooks use their independent registration authentication. Mutations require
an exact Origin matching `A2A_AUTH_ORIGIN` in OIDC mode. Sign out revokes the
session and reloads the page to discard the tab cache. Already admitted bounded
requests may finish; subsequent requests/reconnects recheck membership. Accepted
worker commands continue after logout.

`npm run check` includes signed-token regressions, shared PGlite/PostgreSQL session
contracts and production HTTP using a temporary TLS OIDC issuer (requires
`openssl`). See [ADR 0013](./docs/adr/0013-plane-a-sessions-and-membership.md) and
the [threat model](./docs/security/THREAT_MODEL.md).

## Agent credentials and network policy

The [service identity runbook](./docs/security/SERVICE_IDENTITY.md) covers encrypted
API key/bearer/OAuth client/mTLS bindings, rotation/revocation, team/skill grants,
production origin allowlists and Agent Card trust pins. The gateway validates actual
socket DNS answers, rejects redirects and limits response bytes. Secure HTTP bindings
are supported; gRPC is disabled until a connection-bound resolver adapter exists.
Before upgrading existing binary tasks, preserve their archives and rebuild projections
to establish trusted artifact permissions. See [ADR 0014](./docs/adr/0014-service-credentials-and-scoped-security.md).

## Design background

The full design rationale — prior-art survey, why server-mediated not
browser-direct, the two-plane auth design, and the v1→v2 reframe from
"single-agent chat" to "human entry point into an agent mesh" — lives in
`A2A_LITE_CHAT_UI_DESIGN.md` in the
[SpanPlane](https://github.com/shashikanth-gs/spanplane) repository
(`docs/a2a-lite-chat-ui-design` branch), §7 in particular.

## License

MIT (see `LICENSE`). Includes Apache-2.0 licensed code adapted from
SpanPlane — see `NOTICE`.

### Task reconciliation

Task workers poll each known nonterminal task with `GetTask` every 15 seconds,
including input/auth-required tasks. They also sweep `ListTasks` every 60 seconds
for known organization/agent/tenant scopes, requesting history and artifacts.
Page tokens and read schedules survive restarts; failed reads retry with bounded
backoff. List pages update only already observed tasks. Unsupported listing
(including v0.3 peers) leaves `GetTask` polling active. No streaming or push
capability is required for these reads.

Snapshots enter common ingestion with task/context/tenant validation and lease
fencing. Concurrent task updates and older remote timestamps win over a delayed
read. Terminal work stops polling. Reconciliation never resends commands or
resolves an unknown initial send by guessing which listed task it created.
See [ADR 0010](./docs/adr/0010-task-reconciliation.md) for scheduling and cursor
semantics. Production authorization and a user-facing operational cursor view
remain subsequent work.

### Rebuilding task projections

Projector version 2 serves task detail from normalized task/message/artifact
rows. Existing version 1 tasks remain readable until observed or rebuilt. Apply
`npm run db:migrate` first. Rebuild uses retained events and original binary
archives, checks their integrity, and switches each task atomically; interrupted
runs can be repeated. It does not send user messages or modify the event ledger.

For PostgreSQL, run `npm run db:projections:rebuild` with the same database and
artifact-store configuration as web/workers. Web reads remain available. For
PGlite, stop the web process, then run
`npm run db:projections:rebuild -- --offline-pglite` before restarting it. A
running PGlite owner can instead call `createProjectionRebuilder().rebuild(...)`
without opening another database owner. The CLI defaults to the local
organization; `--organization UUID` and `--task UUID` restrict the scope.

Missing or corrupt archives, tasks without retained events, and repeated
concurrent changes fail without replacing the last readable projection. Keep
database and artifact backups together. Schema rollback exports active content
into the legacy projection before removing the versioned tables. The reducer
reduces overlapping append occurrences across sources; identical chunks without
shared delivery/order identities remain ambiguous and complete snapshots provide
correction. Current ingestion reduces the full per-task ledger; checkpoint and
retention optimizations remain later scaling work.

### Application freshness SSE

`GET /api/tasks/events` signals that durable projections should be read again.
It sends `ready` on connect, `freshness` on committed publication and `resync`
every fifteen seconds. Connections close after 55 seconds and EventSource
reconnects automatically. Frames contain no task content; Last-Event-ID is not
a replay cursor. Tasks list/detail and the shared Chat/flow/alert cache share one
EventSource per tab, re-query after signals/reconnect/focus and retain a
five-second polling fallback. Missing or repeated signals cannot duplicate
messages, artifacts or remote commands.

Projection updates and rebuilds commit retryable outbox intent. The embedded
PGlite worker publishes through a shared in-process bus; PostgreSQL workers
publish a durable organization token that web replicas poll. Both profiles use
the existing task-worker configuration without additional services. Apply
`npm run db:migrate` before starting the updated web/workers. Browser task content and notification read marks are no longer persisted.

### Browser projection cache

`GET /api/task-views` reads organization-scoped content projections for real
Tasks and direct Messages. It returns up to 100 views with a local UUID `after`
cursor; task-only inbox queries remain unchanged. The browser completes all
pages before replacing its in-memory cache. Failed reads preserve the previous
view with a visible retry warning. A send racing that read forces another read;
snapshot revisions reject delayed command-stream content. Reconnect, focus and
five-second fallback reads recover missed signals and discover tasks started
in other sessions. Pagination is eventually consistent across concurrent writes;
the next complete refresh converges.

Old `a2a-agent-workflow-ui` and `a2a-ops` task/notification storage keys are
retired when the app opens. They are never hydrated or imported into the server.
Browser-only historical content without a server record is unavailable. Settings
and theme preferences retain their storage. Pending user turns remain in the
composer until the server reflects them; raw wire events do not create visible
task content. Current alerts derive from server projections even after all
browsers close. Read marks reset when a new browser session starts.

The initial cache refresh reads all pages for the current organization. Larger
workloads will need scoped conversation/inbox queries and selective content
loading behind the same repository boundary; no raw event scan is used here.
