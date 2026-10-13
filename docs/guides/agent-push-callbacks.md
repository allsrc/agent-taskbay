# Receive push callbacks from agents

> Who this is for: operators who want agents to report task changes to Taskbay as they happen, instead of waiting for the next poll. You will have A2A push notifications turned on, a callback URL that agents can reach, and a way to tell whether callbacks arrive.

This page is about A2A push notifications that agents send **into** Taskbay. It is not about the signed webhook that Taskbay sends **out** to your team chat or another system; that is [Notifications](notifications.md).

When push is on, a worker registers a callback with each agent that advertises push support, one per open task. The agent then calls Taskbay's webhook when the task changes. Push is optional. Without it, Taskbay already keeps tasks current through streams (when the agent supports them) and polling reconciliation, which reads each open task about every 15 seconds. Push only makes changes arrive sooner. Taskbay is pre-1.0; this behavior may change.

## Before you start

- The agent must advertise `capabilities.pushNotifications: true` in its Agent Card. The agent's page shows this under **Capabilities** as **Push notifications: Yes**. Taskbay checks the card's capability before it registers a callback.
- The agent must support the A2A push config operations `GetTaskPushNotificationConfig`, `CreateTaskPushNotificationConfig` and `DeleteTaskPushNotificationConfig`, and must send the bearer credential it was given.
- The agent must be able to reach Taskbay's public origin over the network. Callbacks go to the web process, at `POST /api/webhooks/a2a/<registration id>`.
- The callback origin must be HTTPS. Plain HTTP is accepted only for `localhost`, `127.0.0.1` or `[::1]`, and only when you opt in. This holds in every mode, not just production.
- The agent must already be connectable. Taskbay calls the agent to register and delete callbacks through the same connection rules as any other call, including `A2A_ALLOWED_AGENT_ORIGINS`. The callback origin itself is Taskbay's own address and does not go into that allowlist.
- Every process must have the same push settings: the web process (it receives callbacks) and, in external mode, every `npm run worker:tasks` process (it registers them). See [Running and workers](../operations/running-and-workers.md).
- Your reverse proxy must forward `/api/webhooks/a2a/` to the web process without adding its own authentication. Agents call it without a browser session.

## Turn on push

1. Generate a signing key of 64 hexadecimal characters:

```bash
openssl rand -hex 32
```

2. Set the callback origin and the key in the environment of every Taskbay process. The origin is scheme and host only (and a port if needed): no path, query, fragment or credentials.

```bash
A2A_PUSH_CALLBACK_ORIGIN=https://taskbay.example.com
A2A_PUSH_SIGNING_KEY=<the 64 hex characters>
```

For a local test where the agent runs on the same machine, allow loopback HTTP instead:

```bash
A2A_PUSH_CALLBACK_ORIGIN=http://127.0.0.1:3002
A2A_PUSH_SIGNING_KEY=<the 64 hex characters>
A2A_PUSH_ALLOW_LOOPBACK_HTTP=true
```

A full server environment with push and the notification webhook is in [Configuration recipes](configuration-recipes.md#7-notification-webhook-and-agent-push).

3. Restart the web process and every worker. On start, the push worker adds a registration for every open task of an enabled agent that it does not yet track. From then on, each new task gets one when Taskbay first records it.
4. Send a message to an agent that advertises push. The worker asks the agent for an existing callback with the registration ID, and creates one only if none exists. The created callback carries:
   - the URL `<A2A_PUSH_CALLBACK_ORIGIN>/api/webhooks/a2a/<registration id>`, where the registration ID is a UUID;
   - authentication scheme `Bearer` with a 43-character token.

The token is derived from `A2A_PUSH_SIGNING_KEY`, the organization and the registration ID with HMAC-SHA-256. It is never stored. Every process with the same key derives the same token, which is why the key must match everywhere. The code is in [`push-config.ts`](../../src/server/runtime/push-config.ts).

## What the agent sends

Each callback is one `POST` with:

- `Authorization: Bearer <token>`, the token from the registration;
- `Content-Type: application/json` or `application/a2a+json`;
- a body that is one A2A 1.0 stream response with exactly one of `task`, `message`, `statusUpdate` or `artifactUpdate`. A v0.3 full task snapshot (`"kind": "task"`) is also accepted; other v0.3 event shapes are not;
- optionally `X-A2A-Delivery-ID`, printable ASCII up to 255 characters, stable across retries.

The event must name the task the registration was created for, and any `tenant` or `contextId` in it must match. Taskbay answers `204` with no body when it accepted the event.

This is an example of an accepted body, taken from the end-to-end check in [`verify-task-http.mjs`](../../scripts/verify-task-http.mjs):

```json
{
  "statusUpdate": {
    "taskId": "push-task",
    "contextId": "<the task's context ID>",
    "status": {
      "state": "TASK_STATE_INPUT_REQUIRED",
      "timestamp": "2026-10-03T02:00:01Z",
      "message": { "messageId": "push-prompt", "role": "ROLE_AGENT", "parts": [{ "text": "Push input?" }] }
    }
  }
}
```

Callbacks are safe to repeat. Taskbay de-duplicates on `X-A2A-Delivery-ID` when the agent sends one, and on a fingerprint of the event otherwise. A repeated prompt shows up once in the task. If the agent sends identical append chunks of an artifact without a delivery ID, Taskbay may collapse them; send a delivery ID, or send complete artifact snapshots ([Durable tasks](../concepts/durable-tasks.md)).

## Check that it works

There is no push status screen. These are the signals you have:

| Check | Where | Working |
| --- | --- | --- |
| The agent advertises push | The agent's page, **Capabilities** | **Push notifications: Yes** |
| A callback was registered | The agent's own records, or the `task_push_registrations` table | The agent holds one config per open task, with the Taskbay callback URL. The row for the task has `status` `active`. |
| Callbacks are accepted | Your reverse proxy's access log | `POST /api/webhooks/a2a/<uuid>` answered `204` |
| Changes arrive | The task page | The task updates within seconds of the agent's change, without waiting for a poll |
| Cleanup ran | The agent's own records, or the table | After the task finishes, the config is deleted on the agent and the row has `status` `deleted`. Later callbacks for it get `401`. |

The registration row also has a `last_error` column. It holds `Agent does not support task push notifications.` when the agent turned out not to support push, or `Push configuration unavailable; retry scheduled.` while the worker is retrying a failed call to the agent. The columns are listed in the [data model](../reference/data-model.md).

To see the whole cycle on your machine, the production HTTP check registers a callback with a test agent, posts events to the real route, restarts the processes and checks cleanup. It runs against a production build:

```bash
npm run build
```

```bash
node scripts/verify-task-http.mjs
```

On success, its last line starts with `Production HTTP task/command/subscription/push/reconciliation/rebuild/freshness smoke passed`.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| A process stops at start with `A2A_PUSH_SIGNING_KEY must contain 64 hexadecimal characters.` | The origin is set; the key is missing or the wrong length | Generate it with `openssl rand -hex 32` |
| A process stops at start with `Invalid A2A_PUSH_CALLBACK_ORIGIN.` or `A2A_PUSH_CALLBACK_ORIGIN requires an HTTPS origin (or explicitly enabled loopback HTTP).` | Not a URL, not HTTPS, or has a path, query, fragment or credentials | Use `https://host` only. For a local test, use a loopback host with `A2A_PUSH_ALLOW_LOOPBACK_HTTP=true` |
| The agent gets `503` `Push delivery is not configured.` | The web process has no `A2A_PUSH_CALLBACK_ORIGIN` | Set the same push values on the web process as on the worker |
| The agent gets `503` `Push receipt unavailable; retry later.` | An unexpected server error, for example a database problem or invalid push settings on the web process | Read the web log; the agent should retry |
| The agent gets `401` `Invalid push authentication.` | Wrong or missing bearer token, a registration ID that does not exist, a registration that is `deleted` or `failed`, a disabled agent, or a changed signing key | Check that every process has the same key. If the key changed, existing callbacks no longer work |
| The agent gets `415` `Push requires a JSON content type.` | Content type is not `application/json` or `application/a2a+json` | Fix the agent |
| The agent gets `400` `Invalid push event envelope.`, `Invalid push event payload.` or `Invalid push delivery ID.` | The body is not a single valid stream response, or the delivery ID is too long or not printable ASCII | Fix the agent |
| The agent gets `400` `Request body exceeds the 16 MB limit.` or `Invalid request JSON.` | The body is too large or not JSON | Fix the agent |
| The agent gets `409` `Unexpected push task identity.` or `Unexpected push scope.` | The event names a different task, tenant or context than the registration | Fix the agent |
| The agent gets `429` `Push rate limit exceeded.` | More than 120 callbacks in a minute for one registration | Batch events; wait for `Retry-After` (60 seconds) |
| The agent gets `429` `Too many requests. Try again shortly.` | More than 1,200 requests in a minute to the webhook route, from all callers together | Reduce callback volume; wait for `Retry-After` (60 seconds) |
| No callback is ever registered; the row has `status` `failed` and `Agent does not support task push notifications.` | The card does not advertise `pushNotifications` | Nothing to fix in Taskbay; polling covers the task. Enable push on the agent if it supports it |
| The row stays `pending` with `Push configuration unavailable; retry scheduled.` | The agent's push config call failed: network, credentials, or an unexpected config in the response | Check that the agent is reachable and its credentials work. The worker retries after 1, 2, 4, 8, 16 and then every 30 seconds |
| Worker log repeats `Push worker could not access durable state; will retry.` | The worker cannot reach the database | See [Troubleshooting](../operations/troubleshooting.md) |
| Tasks still update, but only every 15 seconds or so | Callbacks are not arriving; reconciliation is covering for them | Check the agent can reach your origin, and your proxy log for the route |

## Limits

- Push is an accelerator, not the source of truth. Reconciliation polls every open task with `GetTask` whether or not push is on, so the change a missed or rejected callback carried is picked up within about 15 seconds ([Running and workers](../operations/running-and-workers.md)).
- Registrations exist only for real tasks. A direct `Message` reply without a task gets none.
- Taskbay deletes the callback on the agent when the task reaches `COMPLETED`, `FAILED`, `CANCELED` or `REJECTED`, or when the agent is disabled. A callback that arrives after the task finished, but before cleanup, gets `204` and changes nothing.
- An agent that does not support push is marked `failed` once and not retried for that task.
- There is no push status in the UI, no metrics, and no command to list or clean up registrations.
- Rotating `A2A_PUSH_SIGNING_KEY`, or unsetting the origin, does not remove the callbacks agents already hold. Their callbacks then get `401` (new key) or `503` (origin unset). No command in this repository does that cleanup, so avoid rotating the key unless you must ([Troubleshooting](../operations/troubleshooting.md)).
- The callback URL uses one origin for all agents. Per-agent callback origins are not supported.
- Behavior was checked against the test agent in `verify-task-http.mjs` and the contract in [`push.db.test.ts`](../../src/server/adapters/db/push.db.test.ts), not against third-party agents.

## Related

- [Durable tasks](../concepts/durable-tasks.md)
- [Configuration reference](../reference/configuration.md)
- [HTTP API: push webhook](../reference/http-api.md#push-webhook-agents-only)
- [Troubleshooting](../operations/troubleshooting.md)
- [Notifications](notifications.md)
