# ADR 0026: A client SDK for Agent Taskbay (proposed, parked)

- Status: Proposed
- Date: 2026-10-06
- Requirements: none yet (would add a product surface and new requirement IDs when accepted)
- Tracking: [#31](https://github.com/allsrc/agent-taskbay/issues/31)

## Context

The question was whether other applications could use Agent Taskbay as an A2A client through an SDK. The architecture has two
candidate seams:

1. The **A2A gateway** (`src/lib/gateway.ts` and `src/server/adapters/a2a/*`): discovery, interface selection, trust, extension
   negotiation, send/stream/get/list/cancel, hardened outbound fetch.
2. The **Taskbay HTTP API**: durable commands with idempotency keys, tasks, inbox, approvals, notifications, audit.

## Decision (proposed)

- Build an SDK for the **Taskbay API** (a typed `@agent-taskbay/client`), not a standalone library from the core gateway.
- Keep the gateway an internal module. `@a2a-js/sdk` already covers the protocol, the gateway's distinguishing features (DNS-pinned
  sockets, private-address blocking, card trust) matter for a server that fetches arbitrary agent URLs, and the behavior people want
  (durable tasks, retries, reconciliation, approvals, audit) lives in the server and workers, not in a client.
- Revisit extracting the gateway only if there is concrete demand.

## Prerequisites

1. **Service-token authentication.** Plane A is only a `__Host-` httpOnly cookie, and `verifyMutationOrigin` rejects cross-origin and
   `sec-fetch-site: cross-site` requests. There is no bearer, API-token or service principal, so no external application can call the API.
   Proposed: scoped, hashed, revocable, organization-bound tokens that reuse membership and `AccessPolicy`, with audit records.
2. **A stable `/api/v1` contract**, derived from schemas rather than UI view types (`src/lib/*-view.ts`), with a versioning policy.
3. **An events strategy for applications.** Application SSE is content-free with no replay (ADR 0012); the SDK would re-query on
   signals or poll. A cursor endpoint or webhook subscription is optional.

## First slice (when accepted)

Service tokens; `/api/v1` for agents, send with an idempotency key, task get/list, cancel, reply and decisions; a typed client with
`waitForTask` and input-required helpers; the existing `scripts/verify-*-http.mjs` scenarios reused as its conformance tests.

## Why parked

The user chose to defer planning. Nothing here changes behavior. This ADR becomes Accepted, or Rejected, when the slice is scheduled.
It must also be added to `docs/spec/PHASES.md` and `docs/spec/STATUS.md` at that point.
