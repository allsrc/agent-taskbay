# ADR 0021: AG-UI adapter over the durable command path

- Status: Accepted
- Date: 2026-10-05
- Requirements: INT-004, INT-002, SEC-004, HITL-005

## Context

`INT-004` asks for an optional AG-UI adapter so richer agent-UI runtimes (for example CopilotKit) can drive
A2A agents through A2A Ops without changing durable task semantics. Research on 2026-10-05 of the AG-UI 1.0
specification (docs.ag-ui.com) found:

- Transport: `POST` of one JSON `RunAgentInput` with `Accept: text/event-stream`; a `200` response whose SSE
  `data:` payloads are each exactly one event object; pre-stream failures are plain HTTP errors; there is no
  stream resumption, so a new run needs a fresh `POST` and `runId`.
- `RunAgentInput`: required `threadId`, `runId`, `messages`; optional `protocolVersion`, `parentRunId`, `state`,
  `tools` (frontend tools), `context`, `forwardedProps`, `resume`.
- Run ordering: `RUN_STARTED` first, then content events, then exactly one of `RUN_FINISHED` or `RUN_ERROR`.
  Text arrives as `TEXT_MESSAGE_START/CONTENT/END`; shared state as `STATE_SNAPSHOT/DELTA`; extensions as `CUSTOM`.
- Human input uses interrupts: a run that stops to ask ends with `RUN_FINISHED` whose `outcome` is
  `{type: "interrupt", interrupts: [{id, reason, message?, responseSchema?, expiresAt?}]}`; the next run's
  `resume` list must answer or explicitly abandon every interrupt, and an interrupted run must never be
  reported as success.
- The experimental `@ag-ui/a2a` package bridges the other direction (AG-UI agents calling A2A services); there is
  no existing adapter that exposes an A2A agent behind durable, authorized, audited ownership.
- A2UI (Google) is a complementary declarative UI format carried inside A2A parts, not a transport; it is handled
  by a separate slice.

## Decision

- Add `POST /api/agents/{agentId}/ag-ui`, disabled unless `A2A_AGUI_ENABLED=true` (the adapter is optional and
  exposes a new external surface; when disabled the route answers 404).
- A run is one durable command. The route authenticates and authorizes exactly like the command API (`operate`
  permission, rate limit, same-origin check, agent and skill grants), accepts the command through the transactional
  outbox, and streams events translated from committed task state. The browser connection never owns dispatch: a
  dropped client leaves the command and task running, and a repeated `runId` is idempotent.
- Mapping: `threadId` is sent as the A2A `contextId`; the last user message's text is the A2A message; agent text
  becomes assistant text-message events; other agent parts and completed artifacts become `CUSTOM` events
  (`a2a.part`, `a2a.artifact`); each task state change emits a `STATE_SNAPSHOT`.
- Terminal mapping: `COMPLETED`/message-only to `RUN_FINISHED` success, `CANCELED` to outcome `cancelled`,
  `FAILED`/`REJECTED` to `RUN_ERROR`, and `INPUT_REQUIRED`/`AUTH_REQUIRED` to an interrupt outcome. The interrupt id is
  `task:{localTaskId}`; when the agent advertises the structured-form extension (ADR 0020) and its form validates,
  the form's JSON Schema is the interrupt's `responseSchema`. If the streaming window (50 s, as for the existing
  stream) ends while the task is still working, the run ends with `RUN_ERROR` code `run_timeout`; the task
  continues durably and its id is in the last `STATE_SNAPSHOT`.
- Resume: exactly one `resume` entry must name an open interrupt of a task in this agent and thread. `answered`
  sends the payload on the same task (string as text, object as an `application/json` data part); `abandoned`
  cancels the task through the cancel command. Anything else is rejected before streaming.
- Not supported in this version, and ignored or rejected rather than half-honoured: frontend `tools`,
  `context`, `state` and `forwardedProps` are ignored; non-text content parts are rejected; skill-scoped principals
  are refused by the existing rule that a skill-scoped send must start a new context; cross-origin browser clients
  are refused by the same-origin check shared with all mutating routes.
- Approval-grade decisions stay in the Phase 4 aggregate. An AG-UI resume answers an agent's own input request like the
  composer does; it is never a decision record, and an interrupt is not a substitute for a reviewer's approval.

## Consequences

- AG-UI clients get durable, audited, authorization-checked runs without a second dispatch path.
- Long-running tasks finish outside the window and are followed through the task APIs or a new run.
- Server-to-server and same-origin clients work first; cross-origin browser clients need a later, explicit CORS design.
