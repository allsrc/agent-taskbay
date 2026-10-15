---
id: T-01
title: Scenario fixture agent for protocol behaviors
phase: 0
status: done
depends_on: []
size: M
gap: harness
migration: no
updated: 2026-10-15
---

# T-01. Scenario fixture agent

## Goal

One controllable fake A2A agent that can show every behavior later tasks must handle, so tests and HTTP checks do not each invent their own. It is a test fixture, never product code.

## Read first

- `scripts/fixture-form-agent.mjs` (JSON-RPC over HTTP, `createServer`, how cards and `SendMessage` are served) and `scripts/fixture-content-agent.mjs`.
- `docs/reference/cli.md` section "Fixture agent script" and `docs/contributing/development.md` "Test and verification variables".
- `scripts/verify-task-http.mjs` for how HTTP suites start fixtures.
- [DECISIONS.md D-03](../DECISIONS.md) for the error names and codes.

## Scope

Create `scripts/fixture-scenario-agent.mjs` exporting `startScenarioAgent({ port, behaviors })` (returns `{ url, cardUrl, control, close }`) and runnable as `node scripts/fixture-scenario-agent.mjs [port]` (default 4012). It is **not** added to `package.json` `files`.

Serve JSON-RPC (same shape as the existing fixture) and implement these methods against an in-memory task store: `SendMessage`, `GetTask`, `ListTasks` (honor `contextId`, `status`, `statusTimestampAfter`, `pageSize`, `pageToken`, `tenant`), `CancelTask`, `SubscribeToTask` (SSE), `CreateTaskPushNotificationConfig`, `GetTaskPushNotificationConfig`, `ListTaskPushNotificationConfigs`, `DeleteTaskPushNotificationConfig`, `GetExtendedAgentCard`. Card at `/card.json` and `/.well-known/agent-card.json`.

Behaviors are switched at runtime through `POST /__control` with a JSON body. Implement all of:

| Behavior | Control body | Effect |
| --- | --- | --- |
| Seed foreign tasks | `{ "seed": [{ "id", "contextId", "state", "title", "updatedAt", "tenant", "history": [...] }] }` | Tasks that exist without a `SendMessage`, as if an automated process started them |
| Advance a task | `{ "advance": { "id", "state", "message" } }` | Moves a task to a state (emits to subscribers) |
| Fail a method | `{ "fail": { "method": "CancelTask", "error": "TaskNotCancelableError" } }` | Returns the matching JSON-RPC error with the code in D-03; also supports `-32603` internal error and `drop` (close the socket after reading the request) |
| Required extension | `{ "requireExtension": "https://example.test/ext/v1" }` | Card lists it with `required: true` |
| Extended card | `{ "extendedCard": { "skills": [...] } }` | Card advertises `extendedAgentCard`; `GetExtendedAgentCard` returns it, or the not-configured error if unset |
| Ignore input while working | `{ "ignoreInputWhileWorking": true }` | `SendMessage` to a working task is accepted but changes nothing |
| Reject input while working | `{ "rejectInputWhileWorking": true }` | `SendMessage` to a working task returns `UnsupportedOperationError` |
| Terminal send | default | `SendMessage` to a terminal task returns `UnsupportedOperationError` |
| No list support | `{ "noList": true }` | `ListTasks` returns method-not-found |
| Tenants | `{ "tenants": ["acme"] }` | Card `supportedInterfaces` carry tenants |
| Reset | `{ "reset": true }` | Clears tasks and behaviors |

Also expose `GET /__state` returning the task store and the request log (method, params, time) so tests can assert what Taskbay sent.

## Design

- Plain Node `http`, no dependencies, like the existing fixtures. Bind `127.0.0.1` only.
- The control endpoint exists only in the fixture. It must refuse non-loopback callers.
- Keep behaviors orthogonal and default to a well-behaved agent so existing tests are unaffected.
- Task ids and timestamps come from the control body when given, otherwise deterministic counters, so tests are stable.

## Acceptance criteria

1. `node scripts/fixture-scenario-agent.mjs 4012` starts and prints the card URL.
2. Every row in the behaviors table works and is covered by a test.
3. With no control calls, a `SendMessage` creates a task that goes `submitted` → `working`; `GetTask`, `ListTasks`, `CancelTask` behave per the A2A v1.0 shapes the SDK expects (the `@a2a-js/sdk` client can call each without throwing).
4. `ListTasks` pagination returns `nextPageToken` until exhausted and `statusTimestampAfter` filters correctly.
5. Documented in `docs/reference/cli.md` and `docs/contributing/development.md`.

## Tests

- `scripts/fixture-scenario-agent.test.ts` (unit, Vitest; check `vitest.config.ts` includes `scripts/`; if it does not, place the test at `src/lib/fixture-scenario-agent.test.ts` importing the script). Drive it with `@a2a-js/sdk/client` (`ClientFactory`) so the SDK itself proves the shapes.
- No `test:db` or `test:http` changes in this task.

## Documentation

- `docs/reference/cli.md`: under "Fixture agent script", add the scenario agent: command, default port, the control endpoint, the behavior table (shortened), and that it is a development fixture not shipped in the npm package.
- `docs/contributing/development.md`: one line in the layout table or the fixtures paragraph pointing to it.

## Hosting profile note

This agent is for repository tests and HTTP checks only. The agent that new users try from `npx agent-taskbay demo-agent` is a variant of the shipped `fixture-form-agent.mjs` (T-27); do not rely on this file being in the npm package.

## Out of scope

- REST binding, gRPC, streaming `SendStreamingMessage`.
- Anything involving `auth-required` (roadmap, D-01).

## Notes for later

## Implementation log

- 2026-10-15 · done: scripts/fixture-scenario-agent.mjs + src/lib/fixture-scenario-agent.test.ts (19 tests, SDK client as driver); docs in cli.md and development.md. Test placed in src/lib because scripts/ is covered by tsc via **/*.ts. Hosting: fixture only, no product state. Pre-existing: tsc reports missing 'dompurify' module in this checkout (npm ci needed), unrelated. SDK note for T-03: non-JSON HTTP failures throw a plain Error whose message holds 'Status: <code>', and v1 JSON-RPC errors carry envelopeCode.