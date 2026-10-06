# Troubleshooting

> For anyone staring at an error from Agent Taskbay. Find the message or symptom, learn the cause, apply the fix.

The messages below are quoted from the code. Some are shown in the browser or an API response, some only in a process log or terminal. Many are intentionally vague, because they must not leak
secrets, tokens or provider responses; for those the table lists the causes to check in order.

API errors have the shape `{"error":{"message":"..."}}`, sometimes with a `name` field, and an HTTP status. If a message is not here, search the source for the exact text.

## Before you start

- Know which process printed the message: the web server, the worker (`npm run worker:tasks`), or a CLI you ran.
- Check configuration against the [configuration reference](../reference/configuration.md) first. Most startup and sign-in failures are one wrong variable.

## Starting the server

| Message or symptom | Where | Cause | Fix |
|---|---|---|---|
| ``agent-taskbay: There is no production build. In a git checkout run `npm run build` first; the published package ships one.`` | Launcher | Running the launcher from a checkout that was never built. | `npm run build`. |
| `agent-taskbay: Agent Taskbay is already running for <dir> (pid N, <url>). Stop it first or use --data-dir.` | Launcher | The data directory holds a PGlite database with a single owner and another launcher is using it. | Stop the other process, or use a different `--data-dir`. |
| `agent-taskbay: Local mode signs everyone in as an administrator, so it cannot listen on <host>. Use 127.0.0.1, or configure OIDC (A2A_AUTH_MODE=oidc and the A2A_OIDC_* settings).` | Launcher | `--host` is not loopback and OIDC is not configured. | Bind loopback or configure [OIDC](../guides/sign-in-and-roles.md). |
| `agent-taskbay: <path>/secrets.json is not valid. Fix or remove it. Removing it makes stored agent credentials unreadable.` | Launcher | Corrupt generated key file. The launcher never overwrites it. | Restore it from backup. Remove it only if you accept re-entering every credential. |
| `agent-taskbay: --port needs a value.`, `"x" is not a valid port.`, `Unknown option --x.`, `Unexpected argument x.` | Launcher | Bad flags. | See `agent-taskbay --help`. |
| `External command workers require PostgreSQL.` | Web, at start | `A2A_COMMAND_WORKER_MODE=external` with PGlite. | Use PostgreSQL, or leave the mode `embedded`. |
| `Invalid A2A_COMMAND_WORKER_MODE.` | Web, at start | Value is neither `embedded` nor `external`. | Fix it. |
| `The separate worker requires PostgreSQL; PGlite uses embedded dispatch.` | Worker | Worker started with `A2A_DATABASE_PROFILE` not `postgresql`. | Set the profile and URL for the worker's environment. |
| `Invalid database configuration: A2A_DATABASE_URL: A2A_DATABASE_URL is required for the postgresql profile` | Any | Profile is `postgresql`, URL missing. | Set `A2A_DATABASE_URL`. |
| `... A2A_DATABASE_URL must use the postgres or postgresql protocol` / `... must be a valid PostgreSQL URL` | Any | Malformed URL. | Use `postgresql://user:password@host:5432/db`. |
| `A2A_PUSH_SIGNING_KEY must contain 64 hexadecimal characters.` | Web or worker, at start | Push origin set, key missing or wrong length. | Generate with `openssl rand -hex 32`. |
| `Invalid A2A_PUSH_CALLBACK_ORIGIN.` / `A2A_PUSH_CALLBACK_ORIGIN requires an HTTPS origin (or explicitly enabled loopback HTTP).` | Web or worker, at start | Not a URL, not HTTPS, or has a path, query or credentials. | Use `https://host` only. For local tests set `A2A_PUSH_ALLOW_LOOPBACK_HTTP=true` with a loopback host. |
| `A2A_NOTIFY_WEBHOOK_SECRET must be at least 32 characters when A2A_NOTIFY_WEBHOOK_URL is set.` | Worker log | Short secret. The notification loop keeps running without external delivery. | Use a secret of 32 or more characters. |
| `Agent allowlist entries must be exact origins.` | Any outbound call | An `A2A_ALLOWED_AGENT_ORIGINS` entry has a path. | Use `https://host[:port]` only. |
| 404 from `/api/agents/<id>/ag-ui` | Web | The AG-UI adapter is off. | Set `A2A_AGUI_ENABLED=true` exactly. See the [AG-UI reference](../reference/ag-ui.md). |
| Page loads, then every call returns 503 | Web | See next section. | |

## Signing in

| Message or symptom | Cause | Fix |
|---|---|---|
| `503` `Identity service unavailable.` on any API call | Authentication configuration invalid (the underlying text, `Authentication is not configured correctly.`, is not shown), or the database is down. | Check: `A2A_AUTH_MODE`, `A2A_OIDC_CLIENT_ID`, `A2A_OIDC_CLIENT_SECRET`, `A2A_AUTH_ORGANIZATION_SLUG`, `A2A_AUTH_FLOW_KEY` (exactly 64 hex), `A2A_OIDC_ISSUER` and `A2A_AUTH_ORIGIN` (HTTPS, issuer without query or fragment, origin without a path), `A2A_AUTH_SESSION_SECONDS` (integer 60 to 86400). In a production build without OIDC, `A2A_ALLOW_DEVELOPMENT_AUTH=true` is also required. |
| `503` `Sign-in service unavailable.` from `/api/auth/login` | Same, or the issuer's discovery document could not be fetched within 10 s. | Test `<issuer>/.well-known/openid-configuration` from the server. |
| `401` `Sign-in failed. Start a new sign-in attempt.` | Callback failed: attempt expired (10 min) or already used, state or nonce mismatch, token invalid, or no enabled membership for that provider subject in the configured organization. Server-side reasons are not exposed. | Retry from the start. Then verify provisioning: same issuer string, exact `sub`, same organization slug. |
| `429` `Too many sign-in requests.` | 240 login or callback calls per minute for the deployment. | Wait. |
| `401` `Sign in to continue.` | No valid session. | Sign in. |
| `403` `This action is not permitted.` | Role too low, no grant for that agent, or a mutating request whose `Origin` header differs from `A2A_AUTH_ORIGIN` (same message). | Check role and grants; send the right `Origin` when scripting. |
| `429` `Too many requests. Try again shortly.` | 900 reads, 120 operations or 60 administrative calls per minute per membership. | Slow down. |
| Sign-in appears to work but you are signed out immediately | Session cookie is `Secure` and `__Host-` prefixed; plain HTTP drops it. | Use the HTTPS origin. |

Fixing identities and roles: [Sign in and roles](../guides/sign-in-and-roles.md).

## Connecting agents

| Message | Cause | Fix |
|---|---|---|
| `Agent Card URL must be http(s).` / `Agent Card URL must not contain credentials, query strings or fragments.` / `Agent Card URL exceeds 1024 characters.` / `cardUrl is required.` | Bad URL when registering. | Use the plain card URL, for example `https://host/.well-known/agent-card.json`. |
| `Enter a valid absolute agent URL.` / `Agent URLs must use HTTP(S) without credentials, query strings or fragments.` | Same checks in the outbound layer. | Same. |
| `Agent target is not in the configured origin allowlist.` | In a production build the card origin, an advertised interface origin, an OAuth token endpoint or the notification webhook is missing from `A2A_ALLOWED_AGENT_ORIGINS`. | Add each exact origin and restart web and worker. |
| `Production agent targets require HTTPS.` | A production build reaching an `http:` agent. | Use HTTPS, or run the local launcher in demo mode. |
| `Agent network address is blocked.` | The name resolves to a loopback, private, link-local or reserved address. Link-local and metadata addresses are never allowed. | For internal agents set `A2A_ALLOW_PRIVATE_NETWORKS=true`. |
| `Agent Card discovery failed. Tried: ...` | None of the card locations answered with a card. The attempts are listed. | Open each URL from the server host; check DNS, TLS and credentials. |
| `Agent Card exceeds the N MB safety limit.` / `Agent response exceeds the safety limit.` | Cards are capped at 2 MB; responses and streams at 25 MiB. | Reduce the card; split large responses. |
| `The card could not be normalized by the official A2A SDK: ...` | The card is not valid for the SDK. | Fix the card; the message carries the SDK's detail. |
| `Agent Card trust policy rejected this connection.` | The card is signed but no pinned key matches (or verification failed), or `A2A_REQUIRE_SIGNED_CARDS=true` and the card is unsigned. | Add a pin to `A2A_TRUSTED_CARD_KEYS`, or sign the card; see [Agent credentials](../guides/agent-credentials.md#agent-card-trust-pins). |
| `Agent credentials are required.` | The card declares security requirements and no binding exists. | Store a binding. |
| `Agent credential destination is not permitted.` | A request target's origin is not in the binding's `origins`. | Add the card and interface origins to the binding. |
| `Agent credentials are disabled.` | The binding was revoked. | Store a new one. |
| `Credential vault unavailable.` | Missing or wrong vault key, invalid ring, or a modified row. | Restore the key ring that encrypted the binding. |
| `Agent OAuth credentials unavailable.` | The client-credentials request failed. | Check token endpoint allowlisting, client ID and secret, and that the response is a bearer token. |
| `Agent redirects are not permitted.` | The agent answered with an HTTP redirect. | Register the final URL. |
| `gRPC transport is unavailable under the hardened network policy; advertise an HTTP binding.` | The only interface is gRPC. | Agent must advertise JSON-RPC or HTTP+JSON. |
| `The selected interface is no longer advertised by the Agent Card.` | The card changed since you chose an interface. | Rediscover and reselect. |
| `Agent network request failed.` / `Protected agent operation failed.` / `Protected agent stream failed.` / `Protected agent subscription failed.` | Generic wrappers; the cause is deliberately hidden. | Test the agent URL from the server host; check the allowlist, DNS, TLS certificate validity, credentials and that the agent is up. |

More on these: [Agent credentials](../guides/agent-credentials.md), [Connect an agent](../guides/connect-an-agent.md).

## Sending and tracking work

Send responses use HTTP 202 and a local command ID; poll `GET /api/commands/<id>` for the outcome.

| Message or status | Cause | Fix |
|---|---|---|
| `An idempotency key of 1–255 characters is required.` (400) | `Idempotency-Key` header missing or too long. | Send one per logical action. |
| `This idempotency key already belongs to different command content.` (409) | Same key, different body. | Reuse a key only to retry the same request. |
| `Unknown or disabled agent.` (404) / `Unknown agent.` | Wrong ID, or the agent was removed or disabled. | Check `GET /api/agents`. |
| `Command accepted; waiting stopped. Query /api/commands/<id> for its outcome before submitting again.` | A compatibility route stopped waiting for the worker. The command is still queued. | Query it; do not resend. Is a worker running? |
| Command stuck in `pending` | No worker running (external mode), or the worker cannot reach the database. | Start or fix the worker: [Running and workers](./running-and-workers.md). |
| Command `failed`: `Agent discovery failed before dispatch after three attempts.` | The agent card could not be fetched three times. | Fix connectivity; send again with a new key. |
| Command `failed`: `Command could not dispatch: unavailable agent or input archive.` | The agent is gone or the saved command input is missing from the artifact directory. | Check the agent and that the artifact directory is the same one the web process wrote to. |
| Command `uncertain`: `Remote outcome is uncertain. Automatic resend is disabled; check the task before submitting new work.` or `A previous dispatch lease expired. Remote outcome requires reconciliation.` | The request may have reached the agent, but the result was not recorded (crash, timeout). Taskbay will not guess. | Look at the agent's side or the task list. Send again only if the work did not happen. |
| `Task not found.` / `Referenced task not found.` / `Task context mismatch.` | The task ID is not one this organization has seen for that agent. | Use the task ID Taskbay returned. |
| `A skill-scoped send must start a new context.` / `Task skill cannot be changed.` / `This agent does not support bounded skill routing.` / `Agent response crossed a task skill boundary.` | Skill grants and the skill-routing extension. | See [Agent credentials: skill grants](../guides/agent-credentials.md#skill-grants). |
| `Request body exceeds the 16 MB limit.` / `Invalid request JSON.` / `Request body is required.` | Request body problems. | Fix the body. |
| A task shows stale state | Stream or push is not reaching Taskbay. Reconciliation corrects it within about a minute. | Check the worker; for push, see below. |

## Push and webhooks

Agents call `POST /api/webhooks/a2a/<registration id>` with a bearer credential Taskbay generated.

| Status and message | Cause | Fix |
|---|---|---|
| 503 `Push delivery is not configured.` | The web process has no `A2A_PUSH_CALLBACK_ORIGIN` and signing key. | Set both, identically, for web and worker. |
| 401 `Invalid push authentication.` | Unknown registration, wrong or missing bearer token, disabled agent, or the signing key changed. | Confirm both processes use the same key. If you changed it, existing registrations stop working. |
| 415 `Push requires a JSON content type.` | Content type is not `application/json` or `application/a2a+json`. | Fix the agent. |
| 400 `Invalid push event envelope.` / `Invalid push event payload.` / `Invalid push delivery ID.` | Payload is not a valid A2A stream response or task. | Fix the agent. |
| 409 `Unexpected push task identity.` / `Unexpected push scope.` | The event names a different task, tenant or context than the registration. | Fix the agent. |
| 429 `Push rate limit exceeded.` | More than 120 callbacks a minute for one registration. | Batch events; honour `Retry-After`. |

Changing `A2A_PUSH_SIGNING_KEY`, or unsetting the origin, does not clean up callbacks that agents already hold. The previous guidance was: stop workers, delete the old remote configurations and local
registrations, configure every process with the new values, then resume. No command in this repository does that cleanup, so avoid rotating the key unless you have to. Unsetting `A2A_PUSH_CALLBACK_ORIGIN` turns
push off; streaming and reconciliation continue.

## Notifications

| Message | Cause | Fix |
|---|---|---|
| `Webhook responded with <status>.` | Your receiver returned an error. Retries up to 8 times. | Fix the receiver. |
| `Webhook request failed.` | Could not connect. | Check the URL, the allowlist (the webhook origin must be in `A2A_ALLOWED_AGENT_ORIGINS`) and TLS. |
| `Delivery failed; retry scheduled.` then `Delivery failed after repeated attempts.` | Persistent failure. The in-app notification still exists. | Fix the receiver; failed deliveries are not replayed. |

See [Notifications](../guides/notifications.md).

## Commands you run

| Message | Command | Fix |
|---|---|---|
| `Credential update failed. Check the organization/agent, vault key configuration and stdin binding format. No secret values are printed.` | `security:credentials` | Work through [the checklist](../guides/agent-credentials.md#when-the-cli-fails). |
| `Stop the local web server and pass --offline-pglite before opening its PGlite directory.` | `security:credentials` | Stop web, add the flag. |
| `Stop web first and explicitly use --offline-pglite for single-owner PGlite.` | `auth:provision` | Same. |
| `An HTTPS issuer without credentials is required.` / `Usage: auth:provision --issuer HTTPS_ISSUER ...` | `auth:provision` | Check flags. |
| `Apply pending database migrations before rebuilding.` / `No local organization; specify --organization UUID.` / `Unknown task in organization.` | `db:projections:rebuild` | See [Upgrading and backups](../guides/upgrading-and-backups.md#rebuild-failures). |
| `Protocol archive missing or corrupt.` / `Protocol archive event digest mismatch.` | Rebuild | Restore the artifact directory from backup. |
| `Artifact exceeds the 16 MB persistence limit.` | An agent produced a binary part over 16 MiB. | The limit is fixed in the filesystem store. |
| `Invalid artifact identity.` | A malformed organization or digest reached the store. | Not an operator action; open an issue with the context. |

## Database and migrations

| Symptom | Cause | Fix |
|---|---|---|
| Requests fail with database errors right after an upgrade | Pending migrations. | `npm run db:migration:pending`, `npm run db:migrate`. |
| `audit records are append-only` / `decision request core is immutable` | A manual UPDATE or DELETE hit a protected table. | Do not modify those rows. |
| A second process cannot open the PGlite directory | PGlite allows one owner. | Stop the other process; use PostgreSQL for a separate worker. |
| `Active task content projection missing.` / `Projection ledger scope mismatch.` and similar | Stored projection and ledger disagree. | Run a [projection rebuild](../guides/upgrading-and-backups.md#rebuild-projections) for the task. |

## Still stuck

Collect: the message, which process printed it, the Taskbay version (`agent-taskbay --version` or `package.json`) and the relevant variable names (never values). Open an issue at
<https://github.com/allsrc/agent-taskbay/issues>. Report security problems privately, following [`SECURITY.md`](../../SECURITY.md).

## Limits

- Several messages are generic by design. This page lists causes rather than a single answer for those.
- No log aggregation, tracing or metrics ship with the project.
- Messages can change between minor versions while the project is pre-1.0.

## Related

- [Running and workers](./running-and-workers.md)
- [Sign in and roles](../guides/sign-in-and-roles.md)
- [Agent credentials](../guides/agent-credentials.md)
- [Production deployment](../guides/production-deployment.md)
