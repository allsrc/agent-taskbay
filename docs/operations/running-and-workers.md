# Running and workers

> For operators who need to know what Agent Taskbay's processes do, how to run the worker separately, and how to tell whether it is healthy.

Taskbay has a web server and a set of background loops (the "worker"). The browser never drives agent work: a send is saved first, then the worker delivers it, watches the task and records what
comes back. That is why you can close the browser and the task keeps being tracked. The mechanism is explained in [Durable tasks](../concepts/durable-tasks.md); this page is the operator's view.

## Two ways to run

| Mode | Setting | How it runs | When to use |
|---|---|---|---|
| Embedded (default) | `A2A_COMMAND_WORKER_MODE=embedded` or unset | The loops start inside the Next.js Node server when it boots. One process. | Local use, demos, PGlite. |
| External | `A2A_COMMAND_WORKER_MODE=external` | The web server starts no loops. You run `npm run worker:tasks` as its own process. | Production with PostgreSQL. |

Details:

- Embedded mode needs a long-running Node server. A serverless or scale-to-zero host will not run the loops reliably.
- External mode requires PostgreSQL. With PGlite the web server fails at start with `External command workers require PostgreSQL.`, and the worker script refuses with `The separate worker requires PostgreSQL; PGlite uses embedded dispatch.`
  PGlite allows one process to own its data directory.
- Any other value for the mode fails at start with `Invalid A2A_COMMAND_WORKER_MODE.`
- The worker needs the same database, artifact directory and server configuration as the web server (see [Production deployment](../guides/production-deployment.md)). It also needs `NODE_ENV=production` in its own
  environment: `next start` sets it for web, but the worker runs under `tsx` and does not.
- `worker:commands` is an alias for `worker:tasks`; both run `scripts/command-worker.ts`.

Stop a worker with SIGTERM or SIGINT. It stops each loop, waits for the current step, closes the database connection and exits.

## What each loop does

All loops are idempotent and retry after a database error, logging a single line and trying again.

| Loop | Job | Timing |
|---|---|---|
| Command dispatch | Takes a saved send or cancel and delivers it to the agent with the same message ID. Retries agent discovery failures up to three attempts (1 s, then 2 s apart); after that the command is `failed`. A crash or lease expiry mid-delivery leaves it `uncertain` and it is **never resent automatically**. | Polls every 250 ms, up to 10 commands per pass. Lease 60 s. |
| Subscriptions | Holds streaming connections to agents for active tasks, renews its lease, reconnects with backoff (1 s doubling to 30 s) and writes events. Stops at input-required, auth-required or a terminal state; a new reply re-arms it. | Up to 8 concurrent streams per worker process. Lease 15 s. |
| Push | Registers webhook callbacks with agents that advertise push, and keeps them in step. Does nothing unless `A2A_PUSH_CALLBACK_ORIGIN` is set. | Idle poll 500 ms. Lease 15 s. |
| Reconciliation | Polls each known unfinished task with `GetTask` and lists tasks with `ListTasks` per agent, so missed events heal even without streaming or push. | `GetTask` about every 15 s per task, `ListTasks` about every 60 s per scope. Two concurrent readers. Lease 15 s. Failures back off from 1 s to 60 s. |
| Freshness | Publishes a content-free "something changed" signal that wakes open browsers. | Polls every 250 ms. |
| Approvals and escalation | Expires overdue approval requests, marks requests superseded when their task finished, refreshes in-flight approved deliveries, and escalates overdue owned tasks. | Every `A2A_DECISION_SWEEP_MS` (default 15000; values below 100, or not a number, fall back to 15000). |
| Notifications | Turns events into inbox rows, then sends each to the signed webhook if one is configured. Webhook delivery retries up to 8 times with backoff from 5 s to 10 min. | Polls every 250 ms. |

The browser side: `GET /api/tasks/events` is a server-sent-events stream that sends `ready`, then `freshness` when something committed and `resync` about every 15 seconds. It closes itself after 55 seconds
and the browser reconnects. It carries no task content; the browser re-reads state from the API. With PostgreSQL, web replicas poll a freshness token every 500 ms, so a change made by a worker on another host
shows up without a message broker.

## Scaling and leases

Any number of workers can share a database. Each unit of work (a command, a subscription, a push registration, a reconciliation cursor) is claimed with a time-limited lease and renewed in the background
about three times per lease. If a worker dies, its leases expire and another worker takes the work over: streams after 15 seconds, command dispatch after 60 seconds. A worker that loses a lease stops
and discards its result rather than writing it (you may see `Dispatch lease lost before completion.` or `Read lease lost.` in logs from an error path; this is the fence working).

The 8-stream cap is per process. If you track many simultaneously active tasks, add worker processes. Nothing in this repository measures throughput, so there are no capacity numbers.

## Health signals

There is no health endpoint and no metrics export. What you have:

| Check | How | Healthy |
|---|---|---|
| Web up, database reachable, auth configured | `curl -i https://YOUR_ORIGIN/api/auth/session` | `401` with `Sign in to continue.` (OIDC). A `503` means configuration or database trouble. |
| Worker alive | Your process supervisor | Running. A healthy worker is silent; it prints nothing on start. |
| Worker can reach the database | Worker log | No repeating `... could not access durable state; will retry.` lines. |
| A send is being processed | `GET /api/commands/<id>` using the ID returned by the send (`202`) | `status` moves from `pending` to `dispatching` to `succeeded`. `failed` and `uncertain` carry a `lastError` text. |
| Tasks keep updating | Open a working task and watch it; or leave a task open and stop the agent | Updates arrive; if the agent goes quiet, reconciliation polls it. |

Log lines the loops print on a database or lease problem, one per failed pass:

```text
Command dispatcher could not access durable state; will retry.
Subscription worker could not access durable state; will retry.
Push worker could not access durable state; will retry.
Reconciliation worker could not access durable state; will retry.
Freshness dispatcher could not access durable state; will retry.
Decision sweeper could not access durable state; will retry.
Escalation sweeper could not access durable state; will retry.
Notification fan-out could not access durable state; will retry.
Notification delivery could not access durable state; will retry.
```

A single line is noise. The same line repeating means the process cannot reach PostgreSQL or the schema is wrong; check [Troubleshooting](./troubleshooting.md).

## Configuration that affects workers

| Variable | Effect |
|---|---|
| `A2A_COMMAND_WORKER_MODE` | `embedded` or `external`, above. |
| `A2A_DECISION_SWEEP_MS` | Interval of the approval and escalation sweep. |
| `A2A_PUSH_CALLBACK_ORIGIN`, `A2A_PUSH_SIGNING_KEY`, `A2A_PUSH_ALLOW_LOOPBACK_HTTP` | Turn on push. Web and worker need identical values. An invalid push key or origin stops the process at start with a named message. |
| `A2A_NOTIFY_WEBHOOK_URL`, `A2A_NOTIFY_WEBHOOK_SECRET`, `A2A_NOTIFY_WEBHOOK_ORGANIZATION` | Signed webhook channel. If misconfigured the notification loop logs the reason and keeps creating in-app notifications without delivering externally. |
| `A2A_ALLOWED_AGENT_ORIGINS`, `A2A_ALLOW_PRIVATE_NETWORKS`, `A2A_VAULT_KEYS`, `A2A_VAULT_ACTIVE_KEY` | Needed by the worker because it makes the outbound calls. |

The complete list is in the [configuration reference](../reference/configuration.md).

## Limits

- Workers have no human identity; they act as the system, which is why accepted work continues after a person signs out or loses access.
- No per-loop switches. The external worker always runs every loop.
- No dashboards for leases, queue depth or cursors. A user-facing view of reconciliation cursors is not built.
- Uncertain commands need a human to check the task on the agent. Taskbay will not resend them.

## Further reading

[Decision record: command dispatch and the local worker](../archive/adr/0007-command-dispatch-and-local-worker.md).

## Related

- [Troubleshooting](./troubleshooting.md)
- [Production deployment](../guides/production-deployment.md)
- [Durable tasks](../concepts/durable-tasks.md)
- [Configuration reference](../reference/configuration.md)
