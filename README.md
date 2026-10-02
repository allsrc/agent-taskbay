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
PGlite or PostgreSQL, and Tasks views read shared server state. Slice 2.1 adds
durable commands and outbox dispatch; follow-up task streams still run while
a browser request is connected. Continuous background task tracking,
authentication, RBAC, push notifications, and an approval audit trail are
planned in the following phases. See **What's not built yet** below.

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
│  ├─ Webhook receiver           (pushNotificationConfig) [TODO]│
│  ├─ Live fan-out (SSE/WS)      (webhook → clients)   [TODO]   │
│  └─ Agent registry service     (catalog, pluggable)           │
├─────────────────────────────────────────────────────────────┤
│  Data layer                                                    │
│  ├─ Observed tasks/events (organization-scoped)             │
│  ├─ Org / users / roles (RBAC)                       [TODO]   │
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
  three-step **Connect agent** flow (Agent Card URL → security scheme →
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
  read the database, refresh every five seconds and on focus, and use local
  UUID URLs. Observed streams, blocking replies, and cancellation responses
  atomically persist events and task projections. Remote IDs are scoped by
  agent and tenant. Binary output is stored outside the database and offered
  as an attachment download.
- **Orchestration** (`/flows`) — tasks of a context and the
  `referenceTaskIds` links between them.
- **Notifications** (`/notifications`) — input requests, finished tasks and
  ready artifacts derived from task streams, with read state and an unread badge.
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

Long-lived subscriptions still depend on the browser's connected request;
worker subscriptions, webhooks, and reconciliation are subsequent Phase 2 work.
Chat, orchestration, and notifications still use browser caches, including
notification read state. Existing browser history is not automatically imported
into the database; new observations become durable. Every request connects to
agents as `{ type: "none" }`; authentication, RBAC, credential storage, typed
approvals, structured start forms, and an audit trail remain planned.
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
serves downloads as attachments; richer content policies remain Phase 3 work.

Initial sends and cancellations persist command intent before dispatch. The
local default starts an embedded dispatcher in the Next.js Node server; use a
long-running server for this profile. For separate workers, configure
PostgreSQL and `A2A_COMMAND_WORKER_MODE=external`, then run
`npm run worker:commands` alongside the web server. Both processes need the
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
sets it; the stream route then subscribes to open tasks while the browser is
connected. These subscriptions are the next slice. Command acceptance appears
in the wire view, and closing that view does not cancel dispatch.

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
commands after browser disconnect and recovery after web restart, then also
tests a separate PostgreSQL worker when the test URL is set. That test account
needs permission to create/drop its temporary test database.

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
