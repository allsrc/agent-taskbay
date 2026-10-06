# Operations guide

How Agent Taskbay runs, and how to operate it. For a first run see the [README](../../README.md); for sign-in and credentials see
[Authentication and agent credentials](./authentication.md).

## Running from source

```bash
git clone https://github.com/shashikanth-gs/agent-taskbay.git
cd agent-taskbay
npm ci
npm run dev                  # http://localhost:3002
```

PGlite is the zero-install database default and `npm run dev` applies migrations on start, so no `.env` file is needed. Copy
`.env.example` to `.env.local` to change settings. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the checks to run before a pull request.
To apply migrations yourself (required for a PostgreSQL database), run `npm run db:migrate`.

Set `A2A_DATABASE_PROFILE=postgresql` and `A2A_DATABASE_URL` to use a PostgreSQL
server instead. `A2A_PGLITE_DATA_DIR` overrides the default `.data/pglite`
directory. Database credentials are server-only configuration.

Binary output and original events containing inline bytes are archived under
`.data/artifacts` (override with `A2A_ARTIFACT_DATA_DIR`). Back up this directory
alongside the database. The initial adapter limits each object to 16 MiB and
serves downloads as attachments subject to current task grants. Remote artifact
media is not automatically loaded.

Initial sends and cancellations persist command intent before dispatch. The
local default starts embedded command, subscription, push, reconciliation, freshness and approval-sweep workers in the Next.js
Node server; use a
long-running server for this profile. For separate workers, configure
PostgreSQL and `A2A_COMMAND_WORKER_MODE=external`, then run
`npm run worker:tasks` alongside the web server (`worker:commands` is an alias). Both processes need the
same database, artifact directory, and server configuration. The worker
requires dev dependencies (`tsx`).

Scripts can submit `POST /api/agents/<local-agent-id>/commands` with an
`Idempotency-Key` header and a send body (`text`/`parts`, optional tenant,
messageId, taskId, contextId, and config), or `action: "cancelTask"` plus
taskId. The API returns 202 and a local command ID; poll
`GET /api/commands/<id>` for status/result. Repeat the same key and content to
recover the original operation; changed content returns 409. Command input is
archived outside relational rows. Discovery failures retry up to three times;
uncertain remote outcomes and expired attempts require investigation and are
never automatically resent.

Compatibility send/cancel routes wait for the durable result. Initial sends
use A2A SendMessage, defaulting to returnImmediately unless config explicitly
sets it. Active task responses atomically create subscription intent. Workers
maintain up to eight concurrent streams, renew leases, reconnect with backoff,
and ingest independently of browsers. Input/auth-required and terminal states
stop observation; an active reply re-arms it. The browser stream reads committed
snapshots and diagnostic events for up to 50 seconds and may reconnect only to known agent/tenant tasks.
Closing it stops the local view while background tracking continues. After a
crash, another worker resumes when the 15-second lease expires.


```bash
npm run lint
npm run test
npm run test:db
npm run db:schema:check
npm run build
npm run test:http # production build required; isolated fixture and restart test
npm run check   # full local quality gate
```

`npm run check` includes the production HTTP test. Database contract tests
always exercise PGlite; set `A2A_TEST_POSTGRES_URL` to exercise PostgreSQL too,
as CI does. The HTTP test uses fresh PGlite and local fixture agents, verifies
commands and observation after browser disconnect, duplicate artifact replay,
input/auth-required prompts, stream reconnect and recovery after killing the
actual database owner/worker, then also
tests a separate PostgreSQL worker when the test URL is set. That test account
needs permission to create/drop its temporary test database.

To enable task push, configure `A2A_PUSH_CALLBACK_ORIGIN` as the console's
externally reachable HTTPS origin and `A2A_PUSH_SIGNING_KEY` as a random 32-byte
key encoded in 64 hexadecimal characters. Both the web and task workers need
the same values. Push stays disabled when the origin is unset. Local loopback
HTTP requires `A2A_PUSH_ALLOW_LOOPBACK_HTTP=true` explicitly.

Workers register existing and newly ingested nonterminal tasks with peers that
advertise push support. The callback is
`POST /api/webhooks/a2a/<registration UUID>`, authenticated by a single-purpose
Bearer credential generated on the server. It accepts canonical A2A 1.0
`StreamResponse` events (`application/a2a+json` or `application/json`) and
explicit v0.3 full Task snapshots. Every callback validates the expected task,
tenant and context; duplicate callbacks commit once. Binary parts use the
ArtifactStore. A durable limit allows 120 authenticated requests per registration
per minute; excess requests return 429 with Retry-After. Invalid authentication
returns 401 before reading the body, invalid payloads return 400, and foreign
routing identity returns 409. Successful receipt returns 204 after commit.

Push registrations survive web/worker restart, retain input/auth-required tasks,
and are deleted on terminal state or agent disablement. Lost create responses
recover through GetConfig using the same ID. Config IDs must be honored by the
peer. Peers without push support stop with a safe operational error; streaming
continues independently where supported. For append chunks, an optional stable
`X-A2A-Delivery-ID` distinguishes identical bytes while preserving retry
idempotency. Without it, identical webhook chunks within a turn collapse; prefer
complete artifact snapshots. Versioned projection rebuild and reconciliation
provide cross-source convergence within the documented identity limits.

Keep the signing key with server secrets and backups. Changing it invalidates
old callback credentials. Before rotation or disabling push, stop workers and
remove old remote configs and their local registrations, then configure all
processes consistently and resume. Managed vault/rotation controls are described in the service identity runbook.
Webhook credential rotation remains a separate lifecycle from agent vault bindings.

## Task reconciliation

Task workers poll each known nonterminal task with `GetTask` every 15 seconds,
including input/auth-required tasks. They also sweep `ListTasks` every 60 seconds
for known organization/agent/tenant scopes, requesting history and artifacts.
Page tokens and read schedules survive restarts; failed reads retry with bounded
backoff. List pages update only already observed tasks. Unsupported listing
(including v0.3 peers) leaves `GetTask` polling active. No streaming or push
capability is required for these reads.

Snapshots enter common ingestion with task/context/tenant validation and lease
fencing. Concurrent task updates and older remote timestamps win over a delayed
read. Terminal work stops polling. Reconciliation never resends commands or
resolves an unknown initial send by guessing which listed task it created.
See [ADR 0010](./docs/adr/0010-task-reconciliation.md) for scheduling and cursor
semantics. A user-facing operational cursor view is planned work.

## Rebuilding task projections

Projector version 2 serves task detail from normalized task/message/artifact
rows. Existing version 1 tasks remain readable until observed or rebuilt. Apply
`npm run db:migrate` first. Rebuild uses retained events and original binary
archives, checks their integrity, and switches each task atomically; interrupted
runs can be repeated. It does not send user messages or modify the event ledger.

For PostgreSQL, run `npm run db:projections:rebuild` with the same database and
artifact-store configuration as web/workers. Web reads remain available. For
PGlite, stop the web process, then run
`npm run db:projections:rebuild -- --offline-pglite` before restarting it. A
running PGlite owner can instead call `createProjectionRebuilder().rebuild(...)`
without opening another database owner. The CLI defaults to the local
organization; `--organization UUID` and `--task UUID` restrict the scope.

Missing or corrupt archives, tasks without retained events, and repeated
concurrent changes fail without replacing the last readable projection. Keep
database and artifact backups together. Schema rollback exports active content
into the legacy projection before removing the versioned tables. The reducer
reduces overlapping append occurrences across sources; identical chunks without
shared delivery/order identities remain ambiguous and complete snapshots provide
correction. Current ingestion reduces the full per-task ledger; checkpoint and
retention optimizations remain later scaling work.

## Application freshness SSE

`GET /api/tasks/events` signals that durable projections should be read again.
It sends `ready` on connect, `freshness` on committed publication and `resync`
every fifteen seconds. Connections close after 55 seconds and EventSource
reconnects automatically. Frames contain no task content; Last-Event-ID is not
a replay cursor. Tasks list/detail and the shared Chat/flow/alert cache share one
EventSource per tab, re-query after signals/reconnect/focus and retain a
five-second polling fallback. Missing or repeated signals cannot duplicate
messages, artifacts or remote commands.

Projection updates and rebuilds commit retryable outbox intent. The embedded
PGlite worker publishes through a shared in-process bus; PostgreSQL workers
publish a durable organization token that web replicas poll. Both profiles use
the existing task-worker configuration without additional services. Apply
`npm run db:migrate` before starting the updated web/workers.

## Browser projection cache

`GET /api/task-views` reads organization-scoped content projections for real
Tasks and direct Messages. It returns up to 100 views with a local UUID `after`
cursor; task-only inbox queries remain unchanged. The browser completes all
pages before replacing its in-memory cache. Failed reads preserve the previous
view with a visible retry warning. A send racing that read forces another read;
snapshot revisions reject delayed command-stream content. Reconnect, focus and
five-second fallback reads recover missed signals and discover tasks started
in other sessions. Pagination is eventually consistent across concurrent writes;
the next complete refresh converges.

Task content and notification read marks are never persisted in the browser; the
server projections are the only source. Settings and theme preferences use browser storage. Pending user turns remain in the
composer until the server reflects them; raw wire events do not create visible
task content. Current alerts derive from server projections even after all
browsers close. Read marks reset when a new browser session starts.

The initial cache refresh reads all pages for the current organization. Larger
workloads will need scoped conversation/inbox queries and selective content
loading behind the same repository boundary; no raw event scan is used here.
