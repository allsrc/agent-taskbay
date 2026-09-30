# a2a-agent-workflow-ui

A human-in-the-loop console for Agent2Agent (A2A) workflows. Discover an
org's registered A2A agents, start tasks, respond to input-required and
auth-required steps, and track task execution in real time with full
multi-modal message and artifact rendering (text, Markdown, JSON, files,
images, audio, video, PDF).

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

- **Agent catalog** (`/catalog`) — lists agents from `src/lib/agent-registry.ts`
  (currently env-var-backed via `A2A_REGISTERED_AGENTS`; kept behind an
  `AgentRegistry` interface so a real directory service can replace it),
  with live Agent Card discovery and skill listings.
- **Start a task** (`/catalog/[agentId]`) — a composer (text / Markdown /
  structured JSON data part, file attachments, and per-request options:
  `returnImmediately`, `historyLength`, `acceptedOutputModes`,
  `referenceTaskIds`, message/request metadata) that opens a real
  `message/stream` against the agent (server-mediated via
  `/api/agents/[agentId]/stream`). The agent answers with a Message (kept as
  a direct-reply thread) or a Task (opens its detail page).
- **Task inbox** (`/inbox`) — tasks grouped into needs-my-input / in-progress
  / completed / failed buckets, per A2A's actual task lifecycle
  (`submitted → working → input-required/auth-required → completed/failed/
  canceled/rejected`), plus direct replies and a by-conversation (`contextId`)
  view.
- **Task detail** (`/tasks/[taskId]`) — chat thread + `ArtifactGallery`
  rendering for every A2A content type in scope, a lifecycle/status-history
  panel, an identifiers panel (context/task/message/artifact IDs), an
  input-required/auth-required banner showing the agent's question, and a
  reply composer that continues the same `taskId`/`contextId`. Terminal tasks
  start a new task in the same context.
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
cp .env.example .env.local   # set A2A_REGISTERED_AGENTS to a comma-separated
                              # list of Agent Card URLs
npm run dev                  # http://localhost:3002
```

```bash
npm run lint
npm run test
npm run build
npm run check   # lint + test + build
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
