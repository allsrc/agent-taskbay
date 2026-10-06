# Production deployment

> For operators putting Agent Taskbay on a shared server. At the end you will have a web process, a worker process and a PostgreSQL database running behind HTTPS, with people signing in through OIDC.

Agent Taskbay is pre-1.0 (version 0.1.0). There is no packaged deployment: no container image, no Helm chart, no Compose file. You deploy it from a source checkout with a process supervisor. This page
says exactly what that involves and what is missing. If you only want to try it on your own machine, use the [quickstart](../quickstart.md) instead.

## What you are deploying

```mermaid
flowchart LR
  B[Browsers] -->|HTTPS| P[Reverse proxy]
  P --> W["web: next start<br/>UI, API, webhook receiver, SSE"]
  W --> D[(PostgreSQL)]
  K["worker: npm run worker:tasks<br/>dispatch, streams, push, reconcile,<br/>freshness, approvals, notifications"] --> D
  W --- A[("artifact directory<br/>shared volume")]
  K --- A
  K -->|A2A calls| G[Your agents]
  G -->|push webhooks| P
  I[OIDC provider] <--> W
```

- **Web** serves the UI and API, receives agent push webhooks and publishes the live-update stream. It holds no state of its own.
- **Worker** does everything that talks to agents: sending commands, long-lived streams, push registration, reconciliation polling, freshness signals, approval expiry and notification delivery. Workers coordinate
  through database leases, so you may run more than one. Detail: [Running and workers](../operations/running-and-workers.md).
- **PostgreSQL** is the system of record. PGlite (the embedded default) allows a single owning process and cannot be shared by a separate worker, so it is not a production profile.
- **Artifact directory** holds binary artifacts and archived protocol events on the filesystem. Web and worker must see the same directory.

## Before you start

- Node 22.19.0 or later, on the machine that builds and on the machines that run.
- A PostgreSQL database and a role that can create tables. CI runs against `postgres:18-alpine`; other versions are not verified.
- An HTTPS origin with a reverse proxy you control, and an OIDC provider (see [Sign in and roles](./sign-in-and-roles.md)).
- A shared filesystem path for artifacts if web and worker run on different hosts.
- A decision on which agents may be reached: you must list their origins ([Agent credentials](./agent-credentials.md#network-policy-for-outbound-calls)).

## Steps

### 1. Get the code and build it

```bash
git clone https://github.com/allsrc/agent-taskbay.git
```

```bash
cd agent-taskbay && npm ci
```

```bash
npm run build
```

Keep the development dependencies installed. The worker and the operator commands run through `tsx`, which is a development dependency, and the migration command uses the MikroORM CLI.

### 2. Write the environment

Both processes read the same variables. A minimal production set (every variable, default and rule is in the [configuration reference](../reference/configuration.md)):

```bash
NODE_ENV=production
A2A_DATABASE_PROFILE=postgresql
A2A_DATABASE_URL=postgresql://taskbay:PASSWORD@db.internal:5432/taskbay
A2A_ARTIFACT_DATA_DIR=/var/lib/taskbay/artifacts
A2A_COMMAND_WORKER_MODE=external
A2A_AUTH_MODE=oidc
A2A_AUTH_ORIGIN=https://taskbay.example.com
A2A_OIDC_ISSUER=https://idp.example.com
A2A_OIDC_CLIENT_ID=...
A2A_OIDC_CLIENT_SECRET=...
A2A_AUTH_ORGANIZATION_SLUG=acme
A2A_AUTH_FLOW_KEY=<64 hex characters>
A2A_VAULT_KEYS={"key-1":"<64 hex characters>"}
A2A_VAULT_ACTIVE_KEY=key-1
A2A_ALLOWED_AGENT_ORIGINS=https://agent.example.com
```

Optional: `A2A_PUSH_CALLBACK_ORIGIN` and `A2A_PUSH_SIGNING_KEY` (agent push), `A2A_NOTIFY_WEBHOOK_URL` and `A2A_NOTIFY_WEBHOOK_SECRET` ([notifications](./notifications.md)), `A2A_AGUI_ENABLED`.

Two things that surprise people:

- `NODE_ENV=production` must be set for the **worker** too. `next start` sets it for web; the worker runs under `tsx` and does not. Without it the worker applies development network rules.
- Not every command loads `.env` files. `worker:tasks`, `security:credentials` and `db:projections:rebuild` do; `auth:provision` does not; whether `db:migrate` does is not verified here. When in doubt, export the
  variables in the shell or the service environment instead of relying on a file.

Keep secrets out of `NEXT_PUBLIC_*` variables. Nothing in Taskbay needs one.

### 3. Apply migrations

```bash
npm run db:migrate
```

Production does not migrate on start unless you set `A2A_AUTO_MIGRATE=true`. With several web replicas, leave it off and run this once per release, before starting the new version. Check with
`npm run db:migration:pending`, which lists what is still unapplied. Details and rollback notes: [Upgrading and backups](./upgrading-and-backups.md).

### 4. Provision the first administrator

```bash
npm run auth:provision -- --issuer https://idp.example.com --subject EXACT_SUBJECT --organization acme --name "Ada Lovelace" --role admin
```

The organization slug must equal `A2A_AUTH_ORGANIZATION_SLUG`. Expected output: `Identity membership provisioned.`

### 5. Start the web process

```bash
npm start
```

This runs `next start -p 3002`. Next.js listens on all interfaces by default; to listen only on loopback behind a proxy on the same host, pass the flag through: `npm start -- -H 127.0.0.1`. If configuration is
incomplete, requests answer 503 rather than starting open (see [Troubleshooting](../operations/troubleshooting.md)).

### 6. Start the worker

```bash
npm run worker:tasks
```

`worker:commands` is an alias for the same script. It requires `A2A_DATABASE_PROFILE=postgresql` and exits with `The separate worker requires PostgreSQL; PGlite uses embedded dispatch.` otherwise. It
starts every loop (commands, streams, push, reconciliation, freshness, approvals, notifications) and stops cleanly on SIGTERM or SIGINT.

Run both processes under a supervisor that restarts them. A crash loses nothing that was already accepted: commands are persisted before dispatch, and another worker takes over expired leases.

### 7. Put HTTPS in front

Terminate TLS at a proxy and forward to the web process. Requirements specific to Taskbay:

- Forward everything under `/` to the web process. Agents call `POST /api/webhooks/a2a/<registration id>` without a browser session; do not put your own authentication in front of that path if you enable push.
- Do not buffer or time out `text/event-stream` responses. The live-update stream (`GET /api/tasks/events`) ends by itself after 55 seconds and the browser reconnects; it already sets `X-Accel-Buffering: no`.
- The request body limit in the application is 16 MB.
- The public origin in `A2A_AUTH_ORIGIN` must be exactly what browsers use. The login redirect and the `Origin` check for mutations come from it, not from `Host` headers.

### 8. Verify

```bash
curl -i https://taskbay.example.com/api/auth/session
```

Expected: `401` with `{"error":{"message":"Sign in to continue."}}`. That means the web process is up, the database answers and authentication is configured. A `503` means a configuration or database
problem. Then:

1. Sign in in a browser. You should land on the task list.
2. Register an agent (Settings or the agent catalog) and send it a message.
3. Stop the worker and send another message. The send is accepted and waits; start the worker and it proceeds. That is the split working.

There is no dedicated health endpoint. The session route above is what the launcher itself uses to decide the server is ready.

## Scaling and availability

| Process | How many | Notes |
|---|---|---|
| Web | Any number | Stateless. Share `A2A_AUTH_FLOW_KEY`, the vault ring and the artifact directory. Leave `A2A_AUTO_MIGRATE` off. |
| Worker | Any number | Each loop claims work with a database lease. Task streams are capped at 8 per process. |
| PostgreSQL | One | High availability, backups and failover are yours. |

Cross-process live updates use a freshness token in PostgreSQL that web replicas poll; no message broker is required. "Any number" is by design; a replica-loss recovery test has not been done, so treat
multi-replica operation as unproven.

## What does not exist yet

| You might expect | Status | What to do instead |
|---|---|---|
| A container image or Dockerfile | Not in the repository | Write your own image from a Node 22 base: copy the checkout, run `npm ci` and `npm run build`, run `npm start` for web and `npm run worker:tasks` for the worker, as two containers from the same image with the same environment and artifact volume. This has not been tested here. |
| Docker Compose or Helm chart | Not in the repository | Compose the three pieces above: web, worker, PostgreSQL. |
| S3 or Azure Blob artifact storage | Not implemented. The store is a port with one filesystem adapter, chosen in code with no setting | Use a shared volume: a network filesystem mounted into every web and worker host. |
| KMS or secrets-manager integration | Not implemented. Vault keys come from `A2A_VAULT_KEYS` | Inject the variable from your own secret manager at process start. |
| Backup and restore tooling | Not provided | Back up the database, the artifact directory and the vault keys together: [Upgrading and backups](./upgrading-and-backups.md). |
| Health, readiness and metrics endpoints | Not provided | Use the session probe above, process supervision and the worker's log lines. |
| Operator CLIs from the npm package | The package ships the build and migrations but not `scripts/` or the MikroORM config | Deploy from a source checkout. Against PostgreSQL the packaged launcher can still migrate itself with `A2A_AUTO_MIGRATE=true`. |

## When it fails

| Symptom | Cause | Fix |
|---|---|---|
| Web answers 503 `Identity service unavailable.` on every call | Incomplete OIDC settings, or no database | [Sign in and roles: when it fails](./sign-in-and-roles.md#when-it-fails) |
| Web fails at start with `External command workers require PostgreSQL.` | `A2A_COMMAND_WORKER_MODE=external` with PGlite | Set `A2A_DATABASE_PROFILE=postgresql` and `A2A_DATABASE_URL`. |
| `Invalid A2A_COMMAND_WORKER_MODE.` | Value is not `embedded` or `external` | Fix the value. |
| `Invalid database configuration: A2A_DATABASE_URL: A2A_DATABASE_URL is required for the postgresql profile` | Profile set, URL missing | Set the URL. |
| Messages are accepted but never reach the agent | No worker running, with `A2A_COMMAND_WORKER_MODE=external` | Start `npm run worker:tasks`. |
| A page works but data is empty after an upgrade | Migrations not applied | `npm run db:migration:pending`, then `npm run db:migrate`. |
| Agent calls fail with `Agent target is not in the configured origin allowlist.` | Origin missing from `A2A_ALLOWED_AGENT_ORIGINS` | Add the exact origin. |

More symptoms and messages: [Troubleshooting](../operations/troubleshooting.md).

## Limits

- Single organization per deployment (`A2A_AUTH_ORGANIZATION_SLUG`).
- No automated deployment artifacts, no tested replica-failure behaviour, no built-in TLS: HTTPS is the proxy's job.
- Filesystem artifact storage only, with a 16 MiB limit per object. The artifact store has no delete or retention methods, so the directory only grows.
- Pre-1.0: migrations and configuration may change between minor versions. Read the changelog before upgrading.

## Further reading

[Design notes on the intended production topology](../archive/deployment/PRODUCTION_TOPOLOGY.md) (written as a plan; the "built and not built" section there matches this page).

## Related

- [Upgrading and backups](./upgrading-and-backups.md)
- [Running and workers](../operations/running-and-workers.md)
- [Configuration reference](../reference/configuration.md)
- [Threat model](../security/threat-model.md)
