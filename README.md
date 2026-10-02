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

This is an early scaffold: the foundation (gateway, content model, rendering,
sideband, request safety, the catalog/inbox/task-detail app shape) is real
and working end to end against a live agent. The parts that make this
enterprise-ready — durable shared task state, auth, RBAC, push notifications,
an audit trail — are designed but not yet built. See **What's not built yet**
below before pointing this at anything beyond a single browser/single agent.

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
│  ├─ Task store service        (durable, queryable)   [TODO]   │
│  ├─ Webhook receiver           (pushNotificationConfig) [TODO]│
│  ├─ Live fan-out (SSE/WS)      (webhook → clients)   [TODO]   │
│  └─ Agent registry service     (catalog, pluggable)           │
├─────────────────────────────────────────────────────────────┤
│  Data layer                                                    │
│  ├─ Tasks (org/team/owner-scoped, not per-browser)   [TODO]   │
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
  identifiers, `SubscribeToTask`, `CancelTask`, open in chat.
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

Task state currently lives in browser-local storage (`src/store/task-store.ts`,
Zustand + `persist` — resume-on-refresh only, not shared across users or
devices), and every request connects to agents as `{ type: "none" }` — no
auth, no RBAC, no push notification config (needs the Phase 1 webhook receiver), no
message `extensions[]` picker, no audit trail, no structured start
forms yet. All of it is designed, phased, and tracked in
[`ROADMAP.md`](./ROADMAP.md), including exit criteria and current
priorities — that file is the source of truth for what's pending; this
section intentionally isn't duplicated here.

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
npm run check   # full local quality gate
```

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
