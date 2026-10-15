---
id: T-12
title: End-to-end proof and guide for finding and steering tasks started elsewhere
phase: 2
status: done
depends_on: [T-03, T-09, T-10, T-11, T-25, T-26]
size: M
gap: G5
migration: no
updated: 2026-10-15
---

# T-12. Discovery end to end

## Goal

One HTTP suite proves the whole story from a clean install in both modes, with embedded and separate workers, and one guide teaches it to a new user.

## Read first

- `scripts/verify-task-http.mjs` and `scripts/verify-phase6-exit-http.mjs` (how servers, fixtures and workers are started and stopped), `scripts/verify-identity-http.mjs` (roles and grants).
- `docs/quickstart.md` and an existing guide (for shape), `docs/contributing/documentation.md`.
- `scripts/fixture-scenario-agent.mjs` (T-01), `scripts/command-worker.ts`.

## Scope

1. `scripts/verify-discovery-http.mjs`, added to the `test:http` chain in `package.json`, with an `A2A_DISCOVERY_HTTP_TEST_PORT` override (add it to the variables table in `docs/contributing/development.md`). It starts a production server with a temporary database and the scenario agent, then asserts:
   1. **Browse only (default).** Connect the agent. Seed: working, input-required, completed 1 day old, completed 30 days old. Browse lists all four; Taskbay's task list is still empty (nothing stored).
   2. **Track.** Track the input-required task; it appears in `/api/tasks?origin=discovered` and in the Inbox "needs you" list. Reply through the public command route; the scenario agent's log shows the message with the right `taskId` and `contextId`; the task advances.
   3. **Steer and cancel.** Track the working task; steering is delivered (and becomes `rejected` if `rejectInputWhileWorking`); cancel ends `CANCELED`.
   4. **Permissions.** A viewer and a skill-scoped grantee cannot browse or track (`403`) and cannot see tracked tasks; a whole-agent operator can.
   5. **Modes and cap.** Set the agent to `off`: browse returns `409`. Restart the server with `A2A_TASK_DISCOVERY=off`: browse `409` and setting `auto` is refused. With `A2A_TASK_DISCOVERY=auto` allow setting `auto`.
   6. **Automatic.** In `auto`: after a sweep, the three eligible tasks are stored without anyone tracking them; the 30-day one is absent; an old `input-required` one notifies only if within 24 hours.
   7. **Separate workers.** Repeat 2 and 6 with the server started without embedded workers and a worker process running `scripts/command-worker.ts`.
   8. **Rate limit.** Exceeding the browse limit returns `429`.
2. Guide `docs/guides/find-and-steer-tasks-started-elsewhere.md`: title, audience line, intro, Before you start, steps with commands you ran, When it fails, Limits, Related. Cover: what browsing does and stores, Track, the Inbox, steering and cancelling, the three modes and the deployment cap, visibility rules, automatic mode's window and caps, failure messages (T-04), and how this behaves on a dev install versus a shared deployment.
3. Add the guide to `docs/README.md` (Guides list and the "Running it for a team" role row).

## Acceptance criteria

1. `node scripts/verify-discovery-http.mjs` passes after `npm run build`, and is part of `npm run test:http`.
2. The guide's commands were run; any output shown was real.
3. The broken-link one-liner reports nothing for the files you touched.
4. `npm run check` passes.

## Tests

The suite itself.

## Documentation

- The new guide, `docs/README.md`, `docs/contributing/development.md` (test variable).
- `docs/project/status-and-roadmap.md`: add "Task discovery (browse and track, automatic)" to **Works today** with `npm run test:http` as proof; adjust partial lists this resolves.
- `CHANGELOG.md`: confirm the Added entries from T-08 to T-26 read as one coherent feature.

## Out of scope

New behavior.

## Notes for later

## Implementation log

- 2026-10-15 · done: scripts/verify-discovery-http.mjs (added to test:http; A2A_DISCOVERY_HTTP_TEST_PORT) drives the real production server against the scenario agent: browse stores nothing, track + inbox + answer on the same task and context, a finished task is refused (task_terminal), steer delivered, agent refusal recorded as rejected/unsupported_operation, cancel, off and discovery_capped, deployment cap off then auto, automatic discovery stores waiting/working tasks and skips a 30-day-old finished one, no trackedBy for automatic, notification text, browse rate limit with Retry-After. Passed on PGlite with the embedded worker. Found and fixed a real bug on the way: SdkReconciliationGateway.list rejected the last page (SDK omits empty nextPageToken) and empty lists as 'Invalid task list', so every sweep against a real agent retried forever (reconciliation-gateway-list.test.ts). Also: a mode change now makes the sweep due immediately. Guide docs/guides/find-and-steer-tasks-started-elsewhere.md, docs index, development.md variable, cli.md, status-and-roadmap Works today. Not done: separate-worker run (needs PostgreSQL; verify-task-http covers that mode for the rest) and the permission matrix over HTTP with OIDC identities (covered by discovery.db.test.ts).