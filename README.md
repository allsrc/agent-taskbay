# Agent Taskbay

[![CI](https://github.com/allsrc/agent-taskbay/actions/workflows/ci.yml/badge.svg)](https://github.com/allsrc/agent-taskbay/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agent-taskbay)](https://www.npmjs.com/package/agent-taskbay)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**The human operations console for A2A agent workflows.**

Created and maintained by [Shashi Kanth G S](https://shashikanth.me) · Part of [Allsrc](https://allsrc.dev), open-source tools for AI agents, interoperability and developer infrastructure.

Agent Taskbay is a human-in-the-loop console for AI agents. Start work with an agent, track it after your browser closes, step in
when an agent needs input or approval, and keep an audit record of who decided what.

It is the human entry point into an organization's existing [Agent2Agent (A2A)](https://a2a-protocol.org) agent mesh, not a
single-agent chat demo or a protocol testbench. A2A already handles agent-to-agent delegation; this is the missing human half: a place
to start a process, get pulled back in exactly when an agent needs a decision, and see it through to done.

Built on the official [`@a2a-js/sdk`](https://www.npmjs.com/package/@a2a-js/sdk).

## Quick start

```bash
npx agent-taskbay
```

That downloads the console, starts it at <http://127.0.0.1:3002> and opens your browser. There is nothing else to install: it uses an
embedded database, generates its own encryption key, and signs you in as a local administrator. Everything lives in `~/.agent-taskbay`
(`--data-dir` to change it). Requires Node.js 22.17 or newer.

To try it without an agent of your own, serve the sample agents in a second terminal and paste a card URL into **Connect agent**:

```bash
npx agent-taskbay demo-agent
```

Local mode is for your own machine only: it has no login screen, so it refuses to listen on anything but loopback. To run it for other
people, configure OIDC and a PostgreSQL database; see [Hosting](#hosting) and [`SECURITY.md`](./SECURITY.md).
`npx agent-taskbay --help` lists the options.

## What it does

- **Agent catalog.** Connect agents by Agent Card URL, with live discovery of capabilities, interfaces, skills and security schemes.
- **Durable tasks.** Commands are persisted before dispatch and observed by background workers, so work continues and is recorded after
  the browser closes. Streams, push callbacks and polling reconciliation converge on one projection.
- **Chat and orchestration.** One conversation, many tasks, in a single timeline with streaming artifacts, input and auth prompts, and
  the context links between tasks.
- **Approvals and ownership.** Approval-grade decisions that execute against the exact reviewed revision, task ownership and
  escalation, and an append-only audit trail.
- **Notifications.** A unified inbox, plus signed outbound webhooks for input requests, finished tasks and ready artifacts.
- **Rich content.** Text, Markdown, JSON, CSV, images, audio, video, PDF and files, rendered deterministically. Agents can ask for
  structured forms, approvals and a safe subset of A2UI (see the extension specs in [`docs/extensions`](./docs/extensions)), and an
  optional AG-UI adapter streams a task to AG-UI clients.
- **Security.** OIDC sign-in with organization roles, encrypted per-agent credentials with team, agent and skill grants, SSRF-safe
  outbound requests with an origin allowlist, and an explicit [threat model](./docs/security/THREAT_MODEL.md).

## Status

Pre-1.0. Phases 0 to 4 and 6 are complete, and Phase 5 (operator experience) is partly done. Still to come: saved views, search and bulk
triage ([#5](https://github.com/allsrc/agent-taskbay/issues/5)), user-delegated OAuth
([#1](https://github.com/allsrc/agent-taskbay/issues/1)), container images and charts, and a client SDK. The current position
and next step are in [`docs/spec/STATUS.md`](./docs/spec/STATUS.md); the plan is in [`ROADMAP.md`](./ROADMAP.md).

## Architecture

Server-mediated, not browser-direct: Next.js API routes proxy to agents, so agent credentials never reach the browser. The system is a
modular monolith with ports and adapters, an event ledger with rebuildable projections, and workers that own agent subscriptions.

```
Browser UI (Next.js)  ──▶  API routes  ──▶  application services  ──▶  ports
                                                                          ├─ database (PGlite / PostgreSQL)
Workers (commands, subscriptions,                                         ├─ artifact store
push, reconciliation, freshness)  ──────────────────────────────────────▶ ├─ A2A gateway (@a2a-js/sdk)
                                                                          └─ identity, secrets, notifications
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for boundaries and data flow, [`docs/adr`](./docs/adr) for the decisions behind them, and
[`docs/spec/DATA_MODEL.md`](./docs/spec/DATA_MODEL.md) for the storage model. The gateway, content model and rendering stack are adapted
from [SpanPlane](https://github.com/shashikanth-gs/spanplane) (Apache-2.0; see [`NOTICE`](./NOTICE)).

## Develop from source

```bash
git clone https://github.com/allsrc/agent-taskbay.git
cd agent-taskbay
npm ci
npm run dev                  # http://localhost:3002
```

PGlite (embedded PostgreSQL) is the zero-install default and `npm run dev` applies migrations on start, so no `.env` file is needed.
Copy `.env.example` to `.env.local` to change settings. Run `npm run check` for the full quality gate; see
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for what to run before a pull request.

## Documentation

| Topic | Where |
| --- | --- |
| Running, workers, command API, push, projections | [`docs/guides/operations.md`](./docs/guides/operations.md) |
| Sign-in, roles, agent credentials | [`docs/guides/authentication.md`](./docs/guides/authentication.md) |
| Agent extensions (forms, approvals, skill routing) | [`docs/extensions`](./docs/extensions) |
| Production topology | [`docs/deployment/PRODUCTION_TOPOLOGY.md`](./docs/deployment/PRODUCTION_TOPOLOGY.md) |
| Security | [`SECURITY.md`](./SECURITY.md), [`docs/security`](./docs/security) |
| Product spec, phases, status | [`docs/spec`](./docs/spec) and [`ROADMAP.md`](./ROADMAP.md) |
| Architecture decisions | [`docs/adr`](./docs/adr) |

## Hosting

Production uses PostgreSQL, OIDC sign-in, an exact outbound origin allowlist and HTTPS, with web replicas and separate workers. The
intended topology and artifact-storage options are in
[`docs/deployment/PRODUCTION_TOPOLOGY.md`](./docs/deployment/PRODUCTION_TOPOLOGY.md); container images and charts are planned work.
Configuration is in `.env.example`, and `A2A_AUTO_MIGRATE=true` applies migrations at server start if you run a single instance.

## Community

[`CONTRIBUTING.md`](./CONTRIBUTING.md) explains how to set up, test and propose a change. Please read [`SECURITY.md`](./SECURITY.md)
before reporting a vulnerability and follow the [Code of Conduct](./CODE_OF_CONDUCT.md). Release notes are in
[`CHANGELOG.md`](./CHANGELOG.md).

Agent Taskbay is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by the A2A project or the
Linux Foundation. "A2A" and "Agent2Agent" refer to the open protocol and are used only to describe compatibility.

## License

MIT (see [`LICENSE`](./LICENSE)). Includes Apache-2.0 licensed code adapted from SpanPlane; see [`NOTICE`](./NOTICE).

Agent Taskbay is created and maintained by [Shashi Kanth G S](https://shashikanth.me) as part of [Allsrc](https://allsrc.dev).
