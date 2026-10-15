# Running and workers

> For operators who need to know what Agent Taskbay's processes do, how to run the worker separately, and how to tell whether it is healthy.

Taskbay has a web server and a set of background loops (the "worker"). The browser never drives agent work: a send is saved first, then the worker delivers it, watches the task and records what
comes back. That is why you can close the browser and the task keeps being tracked. The mechanism is explained in [Durable tasks](../concepts/durable-tasks.md); this page is the operator's view.

## Before you start

- A source checkout with `npm ci` and `npm run build` done. Keep the development dependencies: the worker runs under `tsx`.
- For a separate worker: a PostgreSQL database, `A2A_DATABASE_PROFILE=postgresql` and `A2A_DATABASE_URL` set, and migrations applied with `npm run db:migrate`. Workers never migrate.
- One environment shared by the web server and every worker. The full procedure is in [Production deployment](../guides/production-deployment.md); ready-made variable sets are in [Configuration recipes](../guides/configuration-recipes.md).
- A process supervisor that restarts both processes.

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

## Start the web server and a separate worker

Export the shared environment in the shell or the service definition of both processes. Both also read `.env.production.local`, `.env.local`, `.env.production` and `.env` from the working directory;
values already in the environment win. Set at least:

```bash
export NODE_ENV=production A2A_COMMAND_WORKER_MODE=external A2A_DATABASE_PROFILE=postgresql
```

```bash
export A2A_DATABASE_URL=postgresql://taskbay:PASSWORD@db.internal:5432/taskbay
```

Start the web server (`next start -p 3002`):

```bash
npm start
```

In a second terminal or service, start the worker (`worker:commands` runs the same script):

```bash
npm run worker:tasks
```

Add more workers by starting the same command again, on the same or another host.

A worker that started correctly prints nothing: the script has no startup message, and it writes to the log only when something fails. To confirm it is working, send a message and follow the
command (see [Health signals](#health-signals)). If the worker exits immediately, read the first line of its error output and look it up in [When it fails](#when-it-fails).

## What each loop does

All loops are idempotent and retry after a database error, logging a single line and trying again.

| Loop | Job | Timing |
|---|---|---|
| Command dispatch | Takes a saved send or cancel and delivers it to the agent with the same message ID. Retries agent discovery failures up to three attempts (1 s, then 2 s apart); after that the command is `failed`. A crash or lease expiry mid-delivery leaves it `uncertain` and it is **never resent automatically**. | Polls every 250 ms, up to 10 commands per pass. Lease 60 s. |
| Subscriptions | Holds streaming connections to agents for active tasks, renews its lease, reconnects with backoff (1 s doubling to 30 s) and writes events. Stops at input-required, auth-required or a terminal state; a new reply re-arms it. | Up to 8 concurrent streams per worker process. Lease 15 s. |
| Push | Registers webhook callbacks with agents that advertise push, and keeps them in step. Does nothing unless `A2A_PUSH_CALLBACK_ORIGIN` is set. | Idle poll 500 ms. Lease 15 s. |
| Reconciliation | Polls each known unfinished task with `GetTask` and lists tasks with `ListTasks` per agent, so missed events heal even without streaming or push. For an agent set to automatic task discovery it also stores tasks the agent has that Taskbay does not (see [Task discovery](../guides/connect-an-agent.md#task-discovery)); a sweep keeps its progress on the cursor, so any worker can continue it. | `GetTask` about every 15 s per task, `ListTasks` about every 60 s per scope. Two concurrent readers. Lease 15 s. Failures back off from 1 s to 60 s. |
| Freshness | Publishes a content-free "something changed" signal that wakes open browsers. | Polls every 250 ms. |
| Approvals and escalation | Expires overdue approval requests, marks requests superseded when their task finished, refreshes in-flight approved deliveries, and escalates overdue owned tasks. | Every `A2A_DECISION_SWEEP_MS` (default 15000; values below 100, or not a number, fall back to 15000). |
| Notifications | Turns events into inbox rows, then sends each to the signed webhook if one is configured. Webhook delivery retries up to 8 times with backoff from 5 s to 10 min. | Polls every 250 ms. |

The browser side: `GET /api/tasks/events` is a server-sent-events stream that sends `ready`, then `freshness` when something committed and `resync` about every 15 seconds. It closes itself after 55 seconds
and the browser reconnects. It carries no task content; the browser re-reads state from the API. With PostgreSQL, web replicas poll a freshness token every 500 ms, so a change made by a worker on another host
shows up without a message broker.

## Scaling and leases

Any number of workers can share a database. Each unit of work (a command, a subscription, a push registration, a reconciliation cursor) is claimed with a time-limited lease and renewed in the background
about three times per lease. If a worker dies, its leases expire and another worker takes the work over: streams after 15 seconds, command dispatch after 60 seconds. A worker that loses a lease stops
and discards its result rather than writing it. The lease errors are not printed as such; the loop logs its generic `... could not access durable state; will retry.` line. For a command whose
dispatch lease expired, the worker that takes it over marks it `uncertain` with `A previous dispatch lease expired. Remote outcome requires reconciliation.` instead of sending it again.

The 8-stream cap is per process. If you track many simultaneously active tasks, add worker processes. Nothing in this repository measures throughput, so there are no capacity numbers.

## Health signals

There is no health endpoint and no metrics export. What you have:

| Check | How | Healthy |
|---|---|---|
| Web up, database reachable, auth configured | `curl -i https://YOUR_ORIGIN/api/auth/session` | `401` with `Sign in to continue.` (OIDC). A `503` means configuration or database trouble. |
| Worker alive | Your process supervisor | Running. A healthy worker is silent; it prints nothing on start. |
| Worker can reach the database | Worker log | No repeating `... could not access durable state; will retry.` lines. |
| A send is being processed | `GET /api/commands/<id>` using the ID returned by the send (`202`) | `status` moves from `pending` to `dispatching` to `succeeded`. `failed`, `uncertain` and `rejected` carry a `lastError` text; `rejected` also carries `errorKind`. |
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

## When it fails

| Message or symptom | Where | Cause | Fix |
|---|---|---|---|
| `The separate worker requires PostgreSQL; PGlite uses embedded dispatch.` | Worker exits at start | `A2A_DATABASE_PROFILE` is not exactly `postgresql` in the worker's environment. | Set the profile and `A2A_DATABASE_URL`, or use embedded mode with PGlite. |
| `External command workers require PostgreSQL.` | Web server at start | `A2A_COMMAND_WORKER_MODE=external` with PGlite. | Use PostgreSQL, or unset the mode. |
| `Invalid A2A_COMMAND_WORKER_MODE.` | Web server at start | A value other than `embedded` or `external`. | Fix the value. |
| `A2A_PUSH_SIGNING_KEY must contain 64 hexadecimal characters.`, `Invalid A2A_PUSH_CALLBACK_ORIGIN.` or `A2A_PUSH_CALLBACK_ORIGIN requires an HTTPS origin (or explicitly enabled loopback HTTP).` | Worker (or embedded web server) at start | Push is turned on with an invalid key or origin. | Fix the values ([Agent push callbacks](../guides/agent-push-callbacks.md)), or unset `A2A_PUSH_CALLBACK_ORIGIN`. |
| The same `... could not access durable state; will retry.` line repeating | Worker log | The database is unreachable, or the schema is missing or behind. | Check `A2A_DATABASE_URL` from the worker host; run `npm run db:migration:pending`, then `npm run db:migrate`. |
| `A2A_NOTIFY_WEBHOOK_SECRET must be at least 32 characters when A2A_NOTIFY_WEBHOOK_URL is set.` (or another webhook message) | Worker log, once at start | The notification webhook is misconfigured. | Fix the webhook variables ([Notifications](../guides/notifications.md)). In-app notifications keep working meanwhile. |
| Sends stay `pending` | `GET /api/commands/<id>` | External mode and no worker running, or the worker cannot reach the database. | Start `npm run worker:tasks`; check its log. |
| `uncertain` with `A previous dispatch lease expired. Remote outcome requires reconciliation.` | `GET /api/commands/<id>` | The worker delivering the command died or stalled past the 60-second lease. | Check the task on the agent before sending again. Taskbay will not resend it. |
| `uncertain` with `Remote outcome is uncertain. Automatic resend is disabled; check the task before submitting new work.` | `GET /api/commands/<id>` | Delivery failed after the request may have reached the agent. | Same as above. |
| `failed` with `Agent discovery failed before dispatch after three attempts.` | `GET /api/commands/<id>` | The agent could not be reached before sending. | Check the agent and the network rules in [Agent credentials](../guides/agent-credentials.md#network-policy-for-outbound-calls). |
| Outbound calls follow development rules (private addresses allowed, no allowlist required) | Worker | `NODE_ENV=production` is missing from the worker's environment. | Export it for the worker. |

More symptoms: [Troubleshooting](./troubleshooting.md).

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
- [Configuration recipes](../guides/configuration-recipes.md)
- [Durable tasks](../concepts/durable-tasks.md)
- [Configuration reference](../reference/configuration.md)
