# AG-UI adapter reference

> For developers who want an AG-UI client to drive an A2A agent through Agent Taskbay: how to enable the adapter, the request it accepts, how task state maps to AG-UI events, and
> everything it does not support yet.

The adapter is **optional, off by default and experimental**. It has been exercised with the repository's own verification script (`scripts/verify-agui-http.mjs`) and by hand
against the fixture agent. It has **not** been verified against a real AG-UI client library or the official schema ([#13](https://github.com/allsrc/agent-taskbay/issues/13)).

AG-UI is a protocol for agent-to-UI event streams. Here it is a thin view over the durable task path: one AG-UI run is one durable A2A command, and the events are translated from
what has been committed to the database. The browser connection never owns the work.

## Enable it

Set the environment variable and restart:

```bash
A2A_AGUI_ENABLED=true
```

Only the exact value `true` enables it. Otherwise the route answers `404 {"error":{"message":"The AG-UI adapter is not enabled."}}`. The variable is read on each request.

## Endpoint

```text
POST /api/agents/{agentId}/ag-ui
```

`{agentId}` is the local agent ID from `GET /api/agents`. Authentication, roles and checks are the same as for the command API ([HTTP API](http-api.md#authentication-and-roles)):

- signed-in session, `operate` permission (administrators and operators with an `operate` grant on the agent), 120 requests per minute per person;
- the origin check for non-GET requests, which means **same-origin browser clients and clients that can present a valid session cookie and matching `Origin`**; cross-origin browsers are refused ([#11](https://github.com/allsrc/agent-taskbay/issues/11)).

The response is `200` with `Content-Type: text/event-stream`; each `data:` payload is exactly one event object (AG-UI HTTP+SSE framing). Everything that can be refused is refused **before** streaming
as a normal HTTP error.

## Request

A JSON body (up to 16 MiB), a subset of AG-UI's `RunAgentInput`:

| Field | Required | Rules |
| --- | --- | --- |
| `threadId` | yes | 1 to 255 characters from letters, digits, `.`, `_`, `:`, `-`. Used as the A2A `contextId`. |
| `runId` | yes | Same character rules. Part of the idempotency key. |
| `messages` | yes | 1 to 1,000 messages. Only the **last** one is used and it must have `role: "user"`. Its `content` is a string or an array of parts; only `{ "type": "text" }` parts are accepted (other types are `400 AG-UI content part "<type>" is not supported; send text only.`). Its `id` becomes the A2A `messageId`. |
| `resume` | no | Answers an open interrupt; see [Interrupts and resume](#interrupts-and-resume). At most 20 entries, exactly 1 accepted. |

All other `RunAgentInput` fields (`tools`, `context`, `state`, `forwardedProps`, `parentRunId`, `protocolVersion`) are accepted and ignored ([#10](https://github.com/allsrc/agent-taskbay/issues/10)).

```bash
curl -N -X POST http://127.0.0.1:3002/api/agents/AGENT_ID/ag-ui \
  -H 'Content-Type: application/json' \
  -d '{"threadId":"t1","runId":"r1","messages":[{"id":"u1","role":"user","content":"deploy please"}]}'
```

Observed (development server, fixture agent that asks a question; payloads abbreviated):

```text
data: {"type":"RUN_STARTED","threadId":"t1","runId":"r1","timestamp":1791317119383}

data: {"type":"STATE_SNAPSHOT","snapshot":{"taskId":"a3cf02e9-...","remoteTaskId":"form-task-3","contextId":"t1","state":"INPUT_REQUIRED"},"timestamp":...}

data: {"type":"TEXT_MESSAGE_START","messageId":"agent-form-task-3-TASK_STATE_INPUT_REQUIRED-4","role":"assistant","timestamp":...}

data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"agent-form-task-3-TASK_STATE_INPUT_REQUIRED-4","delta":"Where should I deploy?","timestamp":...}

data: {"type":"TEXT_MESSAGE_END","messageId":"agent-form-task-3-TASK_STATE_INPUT_REQUIRED-4","timestamp":...}

data: {"type":"CUSTOM","name":"a2a.part","value":{"messageId":"...","kind":"data","mediaType":"application/vnd.agent-taskbay.form+json","value":{...}},"timestamp":...}

data: {"type":"RUN_FINISHED","threadId":"t1","runId":"r1","outcome":{"type":"interrupt","interrupts":[{"id":"task:a3cf02e9-...","reason":"input_required","message":"Where should I deploy?","metadata":{"taskId":"form-task-3"}}]},"timestamp":...}
```

## Event mapping

Every run starts with `RUN_STARTED` and ends with exactly one terminal event. Timestamps are Unix milliseconds.

| AG-UI event | Emitted when | Content |
| --- | --- | --- |
| `RUN_STARTED` | First | `threadId`, `runId` |
| `STATE_SNAPSHOT` | The task's state changes (including the first observation) | `snapshot`: `{ taskId, remoteTaskId, contextId, state }`. `taskId` is the local ID; `state` is the A2A state without the `TASK_STATE_` prefix (`WORKING`, `INPUT_REQUIRED`, ...). |
| `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END` | Each new agent message with text, once | `role: "assistant"`; one `delta` with all text parts joined by newlines; `messageId` is the A2A message ID. |
| `CUSTOM` `name: "a2a.part"` | Each non-text part of a new agent message | `value`: `{ messageId, kind, mediaType, filename?, value }`. Data parts larger than 64 KB are sent as `truncated: true` without `value`. Binary parts carry the console's own download reference, never inline bytes. |
| `CUSTOM` `name: "a2a.artifact"` | Each time an artifact is complete or updated | `value`: `{ artifactId, name, parts }` |
| `RUN_FINISHED` | The task reaches a settled state | See below |
| `RUN_ERROR` | The task failed, or the run could not finish | `message`, `code` |

Terminal mapping:

| Task state | Terminal event |
| --- | --- |
| `COMPLETED`, or a plain message with no task | `RUN_FINISHED`, `outcome: { "type": "success" }` |
| `CANCELED` | `RUN_FINISHED`, `outcome: { "type": "cancelled" }` |
| `INPUT_REQUIRED` | `RUN_FINISHED`, `outcome: { "type": "interrupt", ... }`, reason `input_required` |
| `AUTH_REQUIRED` | `RUN_FINISHED`, interrupt with reason `auth_required` |
| `FAILED`, `REJECTED` | `RUN_ERROR`, `code` is the state name, `message` is the agent's last message text if any |
| Not settled when the 50-second window ends | `RUN_ERROR`, `code: "run_timeout"` (the task keeps running) |
| The task's subscription stopped with an error | `RUN_ERROR`, `code: "subscription_stopped"` |
| Storage or command failure after streaming began | `RUN_ERROR`, `code: "stream_unavailable"` (or `unsettled` for an unexpected state) |

An interrupted run is never reported as success.

## Interrupts and resume

An interrupt is `{ id: "task:<local task id>", reason, message, responseSchema?, metadata: { taskId, formExtension? } }`. `message` is the agent's question. When the agent advertises the
[structured-form extension](extensions/structured-form.md) **and** the form validates, `responseSchema` is the form's JSON Schema and `metadata.formExtension` names the extension. Observed: with the card
loaded through the catalog, the interrupt for the fixture's deploy form included `responseSchema` (an object schema with `environment` and `replicas`); before the card had been discovered it did not.

To answer, start the next run with a `resume` list holding **exactly one** entry:

```json
{
  "threadId": "t1", "runId": "r2",
  "messages": [{ "id": "u2", "role": "user", "content": "(ignored when resuming)" }],
  "resume": [{ "interruptId": "task:a3cf02e9-...", "status": "answered", "payload": { "environment": "staging", "replicas": 2 } }]
}
```

| `status` | Effect |
| --- | --- |
| `answered` | Sends `payload` on the same task: a string becomes a text part, any other JSON value becomes one `application/json` data part. A missing or blank payload is `400`. |
| `abandoned` | Cancels the task through the cancel command. |

Refused before streaming: `404 Unknown interrupt.` (wrong agent, wrong thread, or an ID that is not `task:<uuid>`), `409 That interrupt is no longer open.` (the task is not waiting any more), `400` for more than one
resume entry. Observed: answering the deploy interrupt moved the task to `COMPLETED` and the second run ended with `RUN_FINISHED` `success` after a `TEXT_MESSAGE_*` sequence ("Deploying 2 replica(s) to staging.").

A resume is **not** an approval. It answers an agent's own question like the composer does. Approval requests are separate and are not yet exposed as interrupts ([#20](https://github.com/allsrc/agent-taskbay/issues/20)).

## Idempotency, durability and timing

- The idempotency key is a hash of agent, `threadId` and `runId`. Reusing a `runId` does not send a second message. Reusing it with different content is rejected by the same rule as the command API (`409`).
- A dropped client leaves the command and task running. The server stops streaming; query the task by ID (`GET /api/tasks/{id}`) or start a new run.
- The stream watches committed state every 250 ms for up to 50 seconds, then ends with `run_timeout`. Long-running tasks therefore need follow-up reads ([#12](https://github.com/allsrc/agent-taskbay/issues/12)). There is no stream resumption; every reconnect is a new `POST` with a new `runId`.

## Errors before streaming

| Status | Message (abbreviated) |
| --- | --- |
| `400` | Validation text, such as `threadId: Must be 1-255 letters, digits or . _ : -; messages: Too small: expected array to have >=1 items` |
| `401`, `403`, `429` | Sign-in, role, grant, origin and rate-limit failures |
| `404` | `The AG-UI adapter is not enabled.` / `Unknown agent.` / `Unknown interrupt.` |
| `409` | `That interrupt is no longer open.` / idempotency conflict |

## Limits

| Limit | Tracking |
| --- | --- |
| `threadId` is used as the A2A `contextId` verbatim | [#8](https://github.com/allsrc/agent-taskbay/issues/8) |
| Skill-scoped principals are refused (they cannot start a send in an existing context) | [#9](https://github.com/allsrc/agent-taskbay/issues/9) |
| `tools`, `context`, `state`, `forwardedProps` ignored; non-text content rejected; earlier messages ignored | [#10](https://github.com/allsrc/agent-taskbay/issues/10) |
| Cross-origin browser clients are refused | [#11](https://github.com/allsrc/agent-taskbay/issues/11) |
| Runs longer than 50 s end with `run_timeout` | [#12](https://github.com/allsrc/agent-taskbay/issues/12) |
| Not verified against a real client library or official schema | [#13](https://github.com/allsrc/agent-taskbay/issues/13) |
| Approval requests are not mapped to interrupts | [#20](https://github.com/allsrc/agent-taskbay/issues/20) |

Also not supported: shared-state deltas (`STATE_DELTA`), reasoning events, tool-call events and frontend tools.

## Further reading

- [Decision record: AG-UI adapter](../archive/adr/0021-ag-ui-adapter.md)

## Related

- [HTTP API](http-api.md)
- [Rich content](../concepts/rich-content.md)
- [Structured form extension](extensions/structured-form.md)
- [Compatibility](compatibility.md)
