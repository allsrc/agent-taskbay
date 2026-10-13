# Try the AG-UI adapter

> Who this is for: a developer who wants an AG-UI client to drive an A2A agent that is already connected to Agent Taskbay. You will have the adapter turned on, a first run streamed from a sample agent, and an agent question answered through an interrupt.

The AG-UI adapter is **optional, experimental and off by default**. Taskbay is pre-1.0 (package version `0.1.1`), and the adapter may change in any release. It has only been exercised by the repository's own script, `scripts/verify-agui-http.mjs`, not by a real AG-UI client library ([#13](https://github.com/allsrc/agent-taskbay/issues/13)).

The adapter works in one direction. It exposes an A2A agent registered in Taskbay to an AG-UI client at `POST /api/agents/{agentId}/ag-ui`. It does **not** connect Taskbay to agents that speak AG-UI, and it does not add a new kind of agent to the catalog.

Each run is one durable A2A command, accepted the same way as a message from the console. The event stream is translated from task state that is already saved, so closing the connection does not stop the task. Field rules and the full event mapping are in the [AG-UI adapter reference](../reference/ag-ui.md). This page does not repeat them.

## Before you start

- A running console. From a checkout, `npm run dev` serves it at `http://127.0.0.1:3002`. See [Quickstart](../quickstart.md).
- An agent is registered. The steps below use the sample `form` agent, which asks a deployment question. Start the sample agents with `npx agent-taskbay demo-agent`, or `node scripts/fixture-form-agent.mjs 4010` from a checkout, and register `http://127.0.0.1:4010/form/card.json` as described in [Connect an agent](connect-an-agent.md).
- You can operate the agent. That means an administrator, or an operator with an `operate` grant on the whole agent. A grant for one skill only does not work with the adapter ([#9](https://github.com/allsrc/agent-taskbay/issues/9)). See [Sign in and roles](sign-in-and-roles.md).
- You know which sign-in mode you are in, because that decides how a client can call the route:

  | Mode | What a request needs |
  | --- | --- |
  | `development` (the default for `npm run dev` and `npx agent-taskbay`) | Nothing extra. Every request is the local administrator. `curl` works. If you send an `Origin` header, it must be the console's own origin or a loopback origin with the same scheme and port. |
  | `oidc` | A valid `__Host-a2a-session` cookie from a browser sign-in **and** an `Origin` header exactly equal to `A2A_AUTH_ORIGIN`. There is no API key or token. In practice the client must be a page served from the console's own origin. |

  Cross-origin browser clients are refused in both modes ([#11](https://github.com/allsrc/agent-taskbay/issues/11)).

## Steps

### 1. Turn the flag on

The adapter reads `A2A_AGUI_ENABLED`. Only the exact value `true` turns it on. `1`, `TRUE` and `yes` leave it off. See [Configuration](../reference/configuration.md).

For a checkout, put the line in `.env.local`, or set it in the shell that starts the console (next step):

```bash
A2A_AGUI_ENABLED=true
```

For a production build, set it in the environment of the web process.

### 2. Restart the console

Stop the console and start it again with the flag set. For a checkout:

```bash
A2A_AGUI_ENABLED=true npm run dev
```

For the launcher:

```bash
A2A_AGUI_ENABLED=true npx agent-taskbay
```

The launcher listens on port `3002` unless you pass `--port` or set `PORT`. Use the address it prints in the commands below.

### 3. Find the agent ID

The route takes Taskbay's local agent ID (a UUID), not the agent's name or card URL. List the catalog:

```bash
curl -s http://127.0.0.1:3002/api/agents
```

Take the `id` of the entry whose `cardUrl` is the form agent. Loading the catalog also stores the agent's card. The adapter needs that stored card to include the form's JSON Schema in an interrupt, so load the catalog (this command or the **Agents** page) at least once after registering the agent.

In `oidc` mode this call needs a session cookie. Copy the ID from the agent's page in the console instead.

### 4. Send a first run

In development mode, this command is runnable as is after you replace `AGENT_ID`. `-N` turns off buffering so you see events as they arrive.

```bash
curl -N -X POST http://127.0.0.1:3002/api/agents/AGENT_ID/ag-ui -H 'Content-Type: application/json' -H 'Accept: text/event-stream' -d '{"threadId":"thread-1","runId":"run-1","messages":[{"id":"u1","role":"user","content":"Deploy the app"}]}'
```

What the fields do:

- `threadId` is your conversation. It is sent to the agent as the A2A `contextId`, unchanged ([#8](https://github.com/allsrc/agent-taskbay/issues/8)). Use the same `threadId` for every run of one conversation.
- `runId` identifies this run. Use a new one for every run. Sending the same `runId` again does not send a second message to the agent; it streams the same task again.
- `messages` must hold at least one message. Only the last one is used, it must have `role: "user"`, and its content must be text: a string, or an array of `{"type":"text","text":"..."}` parts.

In `oidc` mode a non-browser client cannot do this without copying a session cookie from a browser. A page served by the console can send the run with `fetch`, which adds the cookie and the `Origin` header itself:

```ts
const response = await fetch(`/api/agents/${agentId}/ag-ui`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
  body: JSON.stringify({
    threadId: "thread-1",
    runId: "run-1",
    messages: [{ id: "u1", role: "user", content: "Deploy the app" }],
  }),
});
```

### 5. Read the event stream

A successful call answers `200` with `Content-Type: text/event-stream`. Each `data:` line holds one JSON event. Any refusal (bad input, sign-in, unknown agent) comes back **before** the stream as a normal HTTP error with a JSON body, so check the status first.

A run always starts with `RUN_STARTED` and ends with exactly one terminal event. Look at the last event:

| Last event | Meaning | What to do |
| --- | --- | --- |
| `RUN_FINISHED`, `outcome.type: "success"` | The task completed. | Nothing. |
| `RUN_FINISHED`, `outcome.type: "interrupt"` | The agent is asking a question (`input_required`) or needs authentication (`auth_required`). | Answer it with a resume (step 6). |
| `RUN_FINISHED`, `outcome.type: "cancelled"` | The task was canceled. | Nothing. |
| `RUN_ERROR`, `code: "run_timeout"` | The task did not settle within 50 seconds. It is **still running**. | Read the task with `GET /api/tasks/{taskId}`, using `taskId` from the last `STATE_SNAPSHOT`, or start a new run with a new `runId` ([#12](https://github.com/allsrc/agent-taskbay/issues/12)). |
| `RUN_ERROR`, other `code` | The task failed or was rejected, or the stream broke. | See [When it fails](#when-it-fails). |

With the form agent, the first run ends with an interrupt. The events before it carry the agent's question ("Where should I deploy?") as `TEXT_MESSAGE_*` events and the form itself as a `CUSTOM` event named `a2a.part`. The interrupt looks like this (abbreviated):

```json
{
  "type": "RUN_FINISHED",
  "threadId": "thread-1",
  "runId": "run-1",
  "outcome": {
    "type": "interrupt",
    "interrupts": [{ "id": "task:3f0c...", "reason": "input_required", "message": "Where should I deploy?", "responseSchema": { "type": "object" } }]
  }
}
```

`responseSchema` is present only when the agent advertises the structured-form extension, the form is valid, and the card was loaded in step 3. Every event type and field is listed in the [event mapping](../reference/ag-ui.md#event-mapping).

### 6. Answer the interrupt

Start a new run in the **same thread** with a **new `runId`** and a `resume` list holding exactly one entry. Copy the interrupt `id` exactly, including the `task:` prefix. `messages` is still required, but its content is not sent when you resume.

```bash
curl -N -X POST http://127.0.0.1:3002/api/agents/AGENT_ID/ag-ui -H 'Content-Type: application/json' -H 'Accept: text/event-stream' -d '{"threadId":"thread-1","runId":"run-2","messages":[{"id":"u2","role":"user","content":"answer"}],"resume":[{"interruptId":"INTERRUPT_ID","status":"answered","payload":{"environment":"staging","replicas":2}}]}'
```

- `"status": "answered"` sends `payload` on the same task. A string is sent as text; any other JSON value is sent as one `application/json` data part. The form agent expects an object with `environment` and `replicas`.
- `"status": "abandoned"` cancels the task instead, and the run ends with `outcome.type: "cancelled"`. Leave out `payload`.

The form agent replies with a `TEXT_MESSAGE_*` sequence that confirms the deployment, and the run ends with `RUN_FINISHED` and `outcome.type: "success"` (see the observed runs in the [reference](../reference/ag-ui.md#interrupts-and-resume)). The task is also visible under **Tasks** in the console, and both runs are in the audit trail like any other command.

A resume answers the agent's own question. It is not an approval: approval requests are not exposed as interrupts ([#20](https://github.com/allsrc/agent-taskbay/issues/20)).

To check the whole flow on your build, `scripts/verify-agui-http.mjs` runs these steps against the sample agent. It starts `next start`, so run `npm run build` first:

```bash
node scripts/verify-agui-http.mjs
```

It prints `AG-UI HTTP verification passed.` on success.

## When it fails

Refusals arrive before any event, as JSON `{"error":{"message":"..."}}`. Checks run in this order: sign-in, role, rate limit, origin, then the flag, the agent and the request body. So with the flag off, a caller who is not signed in sees `401`, not `404`.

| Status or event | Message | Cause | Fix |
| --- | --- | --- | --- |
| `404` | `The AG-UI adapter is not enabled.` | `A2A_AGUI_ENABLED` is not exactly `true` in the process that serves the request. | Set it and restart (steps 1 and 2). |
| `404` | `Unknown agent.` | Wrong ID, a removed agent, or one you cannot see. | Take the `id` from `GET /api/agents` (step 3). |
| `401` | `Sign in to continue.` | `oidc` mode with no valid session cookie. | Call from a signed-in page on the console's origin. |
| `403` | `This action is not permitted.` | Viewer role, an `Origin` that does not match, or a browser on another origin. | Use an operator or administrator, and send from the console's own origin ([#11](https://github.com/allsrc/agent-taskbay/issues/11)). |
| `403` | `A skill-scoped send must start a new context.` | Your grant covers one skill, not the whole agent. | Ask an administrator for an `operate` grant on the whole agent ([#9](https://github.com/allsrc/agent-taskbay/issues/9)). |
| `429` | `Too many requests. Try again shortly.` | More than 120 operate requests in a minute. | Wait a minute. |
| `400` | `threadId: Must be 1-255 letters, digits or . _ : -` (and similar for other fields) | An ID with spaces or other characters, or a missing field. | Use only letters, digits, `.`, `_`, `:` and `-`. |
| `400` | `AG-UI content part "image" is not supported; send text only.` | A non-text content part. | Send text only ([#10](https://github.com/allsrc/agent-taskbay/issues/10)). |
| `400` | `The last message must be a user message.` | The last entry in `messages` is not `role: "user"`. | Put the user's message last. |
| `400` | `The user message has no text.` | Empty or blank text. | Send some text. |
| `400` | `resume must answer the single open interrupt of the previous run.` | More than one `resume` entry. | Send exactly one. |
| `400` | `resume names an unknown interrupt.` | The interrupt ID is not `task:<uuid>`. | Copy the `id` from the interrupt exactly. |
| `400` | `An answered interrupt needs a payload.` | `answered` with a missing, `null` or blank payload. | Send a payload, or use `abandoned`. |
| `404` | `Unknown interrupt.` | The interrupt belongs to another agent or another `threadId`. | Resume on the same agent and thread as the run that was interrupted. |
| `409` | `That interrupt is no longer open.` | The task is no longer waiting, for example because it was already answered. | Start a new run without `resume`. |
| `409` | `This idempotency key already belongs to different command content.` | A reused `runId` with a different message. | Use a new `runId` for every run. |
| `RUN_ERROR` | `code: "FAILED"` or `"REJECTED"` | The agent failed or rejected the task. | Read `message`, which is the agent's last text, and the task in the console. |
| `RUN_ERROR` | `code: "run_timeout"` | The task is still running after 50 seconds. | Read the task by ID or start a new run. The task was not stopped. |
| `RUN_ERROR` | `code: "subscription_stopped"` or `"stream_unavailable"` | Taskbay lost its view of the task. | Read the task by ID before retrying. See [Troubleshooting](../operations/troubleshooting.md). |
| All events arrive at once at the end | None | `curl` without `-N`, or a proxy that buffers responses. | Add `-N`; configure the proxy not to buffer `text/event-stream`. |

## Limits

- `threadId` is used as the A2A `contextId` unchanged, so thread IDs are not isolated per agent ([#8](https://github.com/allsrc/agent-taskbay/issues/8)).
- People with a skill-scoped grant cannot use the adapter ([#9](https://github.com/allsrc/agent-taskbay/issues/9)).
- `tools`, `context`, `state` and `forwardedProps` are ignored, earlier messages are ignored, and non-text content is refused ([#10](https://github.com/allsrc/agent-taskbay/issues/10)).
- Cross-origin browser clients are refused, and there is no token authentication ([#11](https://github.com/allsrc/agent-taskbay/issues/11)).
- A run streams for at most 50 seconds, and there is no stream resumption ([#12](https://github.com/allsrc/agent-taskbay/issues/12)).
- Not verified against a real AG-UI client library or the official schema ([#13](https://github.com/allsrc/agent-taskbay/issues/13)).
- Approval requests are not mapped to interrupts, so an AG-UI client cannot approve ([#20](https://github.com/allsrc/agent-taskbay/issues/20)).
- Shared-state deltas, reasoning events, tool-call events and frontend tools are not supported.

## Related

- [AG-UI adapter reference](../reference/ag-ui.md): request fields, event mapping and errors.
- [Rich content](../concepts/rich-content.md): how the adapter fits with forms and other content.
- [HTTP API](../reference/http-api.md#authentication-and-roles): sign-in, roles and the origin check.
- [Compatibility](../reference/compatibility.md): what is verified and what is not.
- [Configuration recipes](configuration-recipes.md#8-the-experimental-ag-ui-adapter): the flag alongside the rest of your environment.
