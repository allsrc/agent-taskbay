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
- **Start a task** (`/catalog/[agentId]`) — a generic text composer that
  opens a real `message/stream` against the agent (server-mediated via
  `/api/agents/[agentId]/stream`) and lands you on the new task's detail page.
- **Task inbox** (`/inbox`) — tasks grouped into needs-my-input / in-progress
  / completed / failed buckets, per A2A's actual task lifecycle
  (`submitted → working → input-required/auth-required → completed/failed/
  canceled/rejected`).
- **Task detail** (`/tasks/[taskId]`) — chat thread + `ArtifactGallery`
  rendering for every A2A content type in scope, and a resume composer for
  `input-required` tasks that continues the same `taskId`/`contextId`.
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

These are designed (see the design doc referenced below) but intentionally
out of scope for this first scaffold:

- **Durable, shared task store.** Task state currently lives in
  browser-local storage (`src/store/task-store.ts`, Zustand + `persist`) —
  resume-on-refresh only, not shared across users or devices. A task list
  that a manager can see and act on for a report's task requires a real
  server-side store; this is the single biggest gap before this is usable
  by more than one person.
- **Auth.** Every request currently connects as `{ type: "none" }`. Two
  independent planes are designed but not implemented: Plane A (OIDC login
  to use the UI) and Plane B (per-agent auth per the Agent Card's
  `securitySchemes` — service-identity first, then user-delegated).
- **RBAC / org model.** Which agents or skills a user may invoke isn't
  gated at all yet.
- **Push notifications.** `tasks/pushNotificationConfig/set` isn't wired to
  a webhook receiver or fan-out; the UI only gets updates from its own open
  stream.
- **Workflow audit trail.** No record yet of who started/approved/rejected
  a task.
- **Structured start forms.** The composer is always the generic
  text/JSON/file fallback; rendering a real form from an agent-advertised
  input schema extension isn't implemented.
- **Docker/CI hardening, Playwright e2e.** CI currently runs lint + unit
  tests + build only.

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
