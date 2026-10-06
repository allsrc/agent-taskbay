# Configuration reference

> For operators who need to know exactly what each `A2A_*` environment variable does, its default and what happens when it is wrong. Every entry
> below was checked against the code that reads it.

Agent Taskbay is configured only through environment variables. There is no configuration file and no settings API. Variable names keep the
`A2A_*` prefix (the project's earlier name); see [#27](https://github.com/allsrc/agent-taskbay/issues/27) for the planned rename.

## How values are loaded

| Process | How it gets its environment |
| --- | --- |
| `npx agent-taskbay` (launcher) | Your shell environment. It adds defaults for anything you did not set (see [launcher defaults](#launcher-defaults)). |
| `next dev` / `next start` (`npm run dev`, `npm run start`) | Your shell environment plus the `.env*` files that Next.js loads from the working directory. |
| `npm run worker:tasks` and `npm run worker:commands` | Shell environment plus `.env*` files (the script calls Next.js's `loadEnvConfig`). |
| `npm run db:projections:rebuild`, `npm run security:credentials` | Shell environment plus `.env*` files (same loader). |
| `npm run auth:provision`, `npm run db:migrate` and the other `db:*` scripts | Shell environment only. These scripts do not call the loader, so export `A2A_DATABASE_*` in your shell. |

Values are read when a process starts or, for a few values, on first use (noted below). Change a value, then restart the process. Empty strings
are treated as unset by most variables; the exceptions are called out.

Never put a secret in a `NEXT_PUBLIC_*` variable. Nothing in this project reads one, and Next.js would expose it to browsers.

## Minimal production example

A single web process on PostgreSQL with OIDC sign-in. Replace every value. The two 64-character hex values are 32 random bytes each
(for example `openssl rand -hex 32`).

```bash
NODE_ENV=production
A2A_DATABASE_PROFILE=postgresql
A2A_DATABASE_URL=postgresql://taskbay:CHANGE_ME@db.internal:5432/taskbay
A2A_AUTO_MIGRATE=false

A2A_AUTH_MODE=oidc
A2A_AUTH_ORIGIN=https://taskbay.example.com
A2A_OIDC_ISSUER=https://idp.example.com
A2A_OIDC_CLIENT_ID=agent-taskbay
A2A_OIDC_CLIENT_SECRET=CHANGE_ME
A2A_AUTH_ORGANIZATION_SLUG=acme
A2A_AUTH_FLOW_KEY=<64 hex characters>

A2A_ALLOWED_AGENT_ORIGINS=https://agents.example.com
A2A_VAULT_KEYS={"key-1":"<64 hex characters>"}
A2A_VAULT_ACTIVE_KEY=key-1
A2A_ARTIFACT_DATA_DIR=/var/lib/agent-taskbay/artifacts
```

Run `npm run db:migrate` once per release before starting the new version. See the
[production deployment guide](../guides/production-deployment.md) for the full procedure.

## Database and storage

| Variable | Default | Valid values | Effect |
| --- | --- | --- | --- |
| `A2A_DATABASE_PROFILE` | `pglite` | `pglite`, `postgresql` | Selects the database. `pglite` is an embedded PostgreSQL that only one process may open. Any other value fails at first database access with `Invalid database configuration: A2A_DATABASE_PROFILE: ...`. |
| `A2A_DATABASE_URL` | none | A `postgres://` or `postgresql://` URL | Required when the profile is `postgresql`. Missing: `A2A_DATABASE_URL is required for the postgresql profile`. Wrong scheme: `A2A_DATABASE_URL must use the postgres or postgresql protocol`. Not a URL: `A2A_DATABASE_URL must be a valid PostgreSQL URL`. Ignored for `pglite`. |
| `A2A_PGLITE_DATA_DIR` | `.data/pglite` under the working directory | A path (relative paths resolve against the working directory) | Where the embedded database lives. The parent directory is created if missing. The launcher sets it to `<data-dir>/pglite`. |
| `A2A_ARTIFACT_DATA_DIR` | `.data/artifacts` under the working directory | A path | Where binary artifacts and original event archives are stored, as content-addressed files per organization. The filesystem store rejects any single object over 16 MiB (`Artifact exceeds the 16 MB persistence limit.`). Back this directory up together with the database. |
| `A2A_DATA_DIR` | `.data` under the working directory (the launcher uses `~/.agent-taskbay`) | A path | Only used to find a legacy `agents.json` (see [`A2A_REGISTERED_AGENTS`](#catalog-and-extensions)). The launcher also keeps its generated `secrets.json` and `agent-taskbay.pid` here. |
| `A2A_AUTO_MIGRATE` | unset | `true` or anything else | Applies pending migrations when the server starts. Exactly `true` enables it; any other non-empty value disables it. When unset or empty it is enabled only for `NODE_ENV=development` with the `pglite` profile (`next dev`). The launcher sets `true` for the `pglite` profile when you did not set it, and leaves it unset for `postgresql`, so PostgreSQL is not migrated automatically. Separate worker processes never migrate. |

Migrations are in `src/server/adapters/db/migrations/` and are tracked in the `agent_taskbay_migrations` table.

## Authentication (people)

These control how people sign in to the console. Agent credentials are a different thing; see
[Identity and access](../concepts/identity-and-access.md).

| Variable | Default | Valid values | Effect |
| --- | --- | --- | --- |
| `A2A_AUTH_MODE` | `development` when `NODE_ENV` is not `production`; `oidc` when it is | `development`, `oidc` | `development` signs every request in as one local administrator. `oidc` uses an OpenID Connect provider. Any other value fails closed. |
| `A2A_ALLOW_DEVELOPMENT_AUTH` | `false` | `true` | Required, together with `A2A_AUTH_MODE=development`, to use development identity under `NODE_ENV=production`. Without it a production build refuses to start serving identity. The launcher sets both. Never set this on a network-reachable deployment: every caller is an administrator. |
| `A2A_AUTH_ORIGIN` | none | An `https://` origin with no path, query, fragment or credentials | Required for `oidc`. The externally visible origin. The callback is `<origin>/api/auth/callback`; register exactly that redirect URI with your provider. Forwarded and `Host` headers never override it. |
| `A2A_OIDC_ISSUER` | none | An `https://` URL without credentials, query or fragment | Required for `oidc`. Discovery runs against this issuer. ID tokens must be signed with RS256. |
| `A2A_OIDC_CLIENT_ID` | none | Non-empty string | Required for `oidc`. |
| `A2A_OIDC_CLIENT_SECRET` | none | Non-empty string | Required for `oidc`. The client authenticates with `client_secret_post`. |
| `A2A_AUTH_ORGANIZATION_SLUG` | none | Organization slug | Required for `oidc`. The organization every sign-in is resolved against. Role, organization and e-mail claims from the provider are ignored; membership comes from [`npm run auth:provision`](cli.md#npm-run-authprovision). |
| `A2A_AUTH_FLOW_KEY` | none | Exactly 64 hex characters | Required for `oidc`. Encrypts the short-lived login state (10 minutes). Share one value across all web replicas. Changing it invalidates sign-ins in progress. |
| `A2A_AUTH_SESSION_SECONDS` | `28800` (8 hours) | Integer from `60` to `86400` | Absolute session lifetime and cookie max age. Out of range or not an integer fails closed. |

If `oidc` is selected and any required value is missing or malformed, the server does not fall back to development identity. Authenticated
routes answer `503 {"error":{"message":"Identity service unavailable."}}` and sign-in answers `503 "Sign-in service unavailable."`.
Details and recovery are in [Sign in and roles](../guides/sign-in-and-roles.md).

Cookies are named `__Host-a2a-session` and `__Host-a2a-login` and are always `Secure`, so OIDC sign-in requires HTTPS.

## Outbound network policy

| Variable | Default | Valid values | Effect |
| --- | --- | --- | --- |
| `A2A_ALLOWED_AGENT_ORIGINS` | empty | Comma-separated exact origins, such as `https://agents.example.com,https://auth.example.com` | If set, every outbound URL must have one of these origins, in every environment: Agent Card URLs, the interface URLs inside cards, OAuth token endpoints for agent credentials, and the notification webhook URL. A mismatch fails with `Agent target is not in the configured origin allowlist.` An entry with a path fails with `Agent allowlist entries must be exact origins.` Required under `NODE_ENV=production` unless [demo mode](#launcher-defaults) is on; when it is required and empty, every target is rejected. |
| `A2A_ALLOW_PRIVATE_NETWORKS` | `false` in production; allowed outside production | `true`, `false` | Whether targets that resolve to private, unique-local or loopback addresses are allowed. `true` allows them everywhere; `false` blocks them even in development. Link-local, metadata, multicast and other reserved ranges are always blocked (`Agent network address is blocked.`). The check runs against the address the socket actually connects to, so DNS rebinding does not bypass it. |

Other outbound rules are fixed in code: URLs may not contain credentials, a query string or a fragment; redirects are never followed
(`Agent redirects are not permitted.`); production requires HTTPS (demo mode excepted); agent responses are limited to 25 MiB and Agent Cards to 2 MiB.

## Agent credentials and card trust

| Variable | Default | Valid values | Effect |
| --- | --- | --- | --- |
| `A2A_VAULT_KEYS` | none | A JSON object mapping key IDs to 64-hex-character keys, for example `{"key-1":"<64 hex>"}` | The key ring that encrypts stored agent credentials (AES-256-GCM, compact JWE). Key IDs match `^[a-zA-Z0-9_-]{1,64}$`. Required to store or use any agent credential. Keep retired keys in the ring until every credential has been re-encrypted with the active key (`npm run security:credentials -- --action reencrypt`). Invalid or missing: credential operations fail with `Credential vault unavailable.` |
| `A2A_VAULT_ACTIVE_KEY` | none | One of the key IDs above | The key used to encrypt new and re-encrypted credentials. The launcher generates a key and sets both variables if `A2A_VAULT_KEYS` is unset. |
| `A2A_TRUSTED_CARD_KEYS` | `[]` | A JSON array of `{ "origin", "kid", "jwk", "expiresAt" }` | Public keys that are trusted to sign Agent Cards, pinned per origin. `origin` is the origin of the Agent Card URL. `jwk` must be a public key with an `alg` of `RS256`, `ES256` or `EdDSA` that matches the signature header. `expiresAt` is an ISO timestamp; an expired pin is ignored. Keys advertised by a card are never fetched. Only read when a card carries signatures. Malformed JSON makes signed cards report `invalid`. |
| `A2A_REQUIRE_SIGNED_CARDS` | `false` | `true` | When `true`, a card must verify against a pinned key before the gateway talks to the agent. When not `true`, unsigned cards are accepted, but cards with signatures that are `untrusted` or `invalid` are still rejected with `Agent Card trust policy rejected this connection.` |

Format of a credential binding and the rotation procedure: [Agent credentials](../guides/agent-credentials.md).

## Workers

| Variable | Default | Valid values | Effect |
| --- | --- | --- | --- |
| `A2A_COMMAND_WORKER_MODE` | `embedded` | `embedded`, `external` | `embedded` runs the background loops inside the web server process. `external` starts none of them there; run `npm run worker:tasks` yourself. `external` with the `pglite` profile throws `External command workers require PostgreSQL.`; any other value throws `Invalid A2A_COMMAND_WORKER_MODE.` Both checks run at server start. |
| `A2A_DECISION_SWEEP_MS` | `15000` | Number of milliseconds, `100` or more | Interval for the approval and escalation sweep: expire overdue approvals, supersede approvals whose task finished, refresh in-flight approved deliveries, and escalate overdue owned tasks. Values below 100 or non-numeric values fall back to `15000`. |
| `A2A_PUSH_CALLBACK_ORIGIN` | unset (push disabled) | An `https://` origin with path `/` and no credentials, query or fragment | Enables worker-managed A2A push notifications. The callback URL registered with agents is `<origin>/api/webhooks/a2a/<registration id>`, so the origin must be reachable by the agents. Invalid values throw `A2A_PUSH_CALLBACK_ORIGIN requires an HTTPS origin (or explicitly enabled loopback HTTP).` when the worker starts. |
| `A2A_PUSH_SIGNING_KEY` | none | Exactly 64 hex characters | Required when the callback origin is set (`A2A_PUSH_SIGNING_KEY must contain 64 hexadecimal characters.`). Per-registration bearer tokens are derived from it with HMAC-SHA-256 and are not stored. Web and workers must share the same value. |
| `A2A_PUSH_ALLOW_LOOPBACK_HTTP` | `false` | `true` | Allows a plain `http://` callback origin, but only for `localhost`, `127.0.0.1` or `[::1]`. For local testing only. |

Other worker timings (leases, polling intervals, retry backoff) are constants in the source and are not configurable. See
[Running and workers](../operations/running-and-workers.md) for what each loop does.

## Notifications

| Variable | Default | Valid values | Effect |
| --- | --- | --- | --- |
| `A2A_NOTIFY_WEBHOOK_URL` | unset (in-app notifications only) | An `http(s)` URL without credentials, query string or fragment | Also POST each notification for one organization to this URL. Its origin must be in `A2A_ALLOWED_AGENT_ORIGINS` when that is set, and the usual network policy applies. The payload includes a Slack-compatible `text` field. |
| `A2A_NOTIFY_WEBHOOK_SECRET` | none | At least 32 characters | Required with the URL (`A2A_NOTIFY_WEBHOOK_SECRET must be at least 32 characters when A2A_NOTIFY_WEBHOOK_URL is set.`). Signs each delivery: header `X-Agent-Taskbay-Signature: v1=<hex HMAC-SHA-256 of "<timestamp>.<body>">`, with `X-Agent-Taskbay-Timestamp` (Unix seconds) and `X-Agent-Taskbay-Delivery` (notification ID, for de-duplication). |
| `A2A_NOTIFY_WEBHOOK_ORGANIZATION` | `local` | Organization slug | The one organization whose notifications are sent. Set it to your `A2A_AUTH_ORGANIZATION_SLUG` when you use OIDC. |

Delivery is at least once with a 10-second timeout per attempt. Setup and a verification snippet: [Notifications](../guides/notifications.md).
When `A2A_AUTH_ORIGIN` is set, links in webhook messages are absolute URLs on that origin.

## Catalog and extensions

| Variable | Default | Valid values | Effect |
| --- | --- | --- | --- |
| `A2A_REGISTERED_AGENTS` | empty | Comma-separated Agent Card URLs | Agents the catalog seeds itself with, for the `local` organization only. They are re-seeded on every access and cannot be removed from the UI or API (`409 This agent comes from A2A_REGISTERED_AGENTS and can't be removed from the UI.`). Remove the entry and restart to drop one. A legacy `<A2A_DATA_DIR>/agents.json` is imported once into the same organization and left unchanged. |
| `A2A_SIDEBAND_EXTENSION_URIS` | empty | Comma-separated extension URIs | Extra extension URIs to negotiate with agents, in addition to the built-in `urn:agent-observability:sideband-events:v1` and `urn:x-a2a:trace:v1`. Events delivered under negotiated URIs appear as sideband events on the task stream. The singular name `A2A_SIDEBAND_EXTENSION_URI` is accepted as an alias when the plural is unset. See [Extensions](extensions/README.md). |
| `A2A_AGUI_ENABLED` | `false` | exactly `true` | Enables `POST /api/agents/{agentId}/ag-ui`. Any other value, including `1` or `TRUE`, leaves it off and the route answers `404 The AG-UI adapter is not enabled.` Read per request. See [AG-UI adapter](ag-ui.md). |

The structured-form, approval-request and A2UI extensions need no variable; they activate when an agent advertises them.

## Process variables

| Variable | Read by | Effect |
| --- | --- | --- |
| `NODE_ENV` | server, launcher | `production` makes OIDC the default, requires the origin allowlist, blocks private networks by default and requires HTTPS for agent targets. `next dev` sets `development`; `next start` and the launcher use `production`. |
| `PORT` | launcher | Default port for `npx agent-taskbay` when `--port` is not given. `npm run dev` and `npm run start` use port `3002`. |
| `HOSTNAME` | `next start` | Set by the launcher from `--host`. |
| `CI` | launcher | When set, the launcher does not open a browser unless `--open` is passed. |

## Launcher defaults

`npx agent-taskbay` sets the following only when you have not already set them. See [CLI reference](cli.md#agent-taskbay).

| Variable | Value the launcher uses |
| --- | --- |
| `NODE_ENV` | `production` (always) |
| `A2A_DATA_DIR` | `--data-dir`, else `$A2A_DATA_DIR`, else `~/.agent-taskbay` |
| `A2A_ARTIFACT_DATA_DIR` | `<data-dir>/artifacts` |
| `A2A_PGLITE_DATA_DIR` | `<data-dir>/pglite` (not set when the profile is `postgresql`) |
| `A2A_AUTO_MIGRATE` | `true` (not set when the profile is `postgresql`) |
| `A2A_VAULT_KEYS`, `A2A_VAULT_ACTIVE_KEY` | A random key stored in `<data-dir>/secrets.json` (mode 0600) as `local-1` |
| `A2A_AUTH_MODE`, `A2A_ALLOW_DEVELOPMENT_AUTH` | `development` and `true`, unless `A2A_AUTH_MODE=oidc` or `A2A_OIDC_ISSUER` is set |
| `A2A_ALLOW_PRIVATE_NETWORKS` | `true` in development mode, so agents on localhost can be reached |

"Demo mode" is the combination of `A2A_AUTH_MODE=development` and `A2A_ALLOW_DEVELOPMENT_AUTH=true` on a production build. In it, an empty
`A2A_ALLOWED_AGENT_ORIGINS` does not block outbound targets and HTTP targets are allowed. A configured allowlist is still enforced. Because
development identity makes every caller an administrator, the launcher refuses non-loopback `--host` values unless OIDC is configured.

## Variables used only by tests and scripts

These are read by the repository's verification scripts, not by the application. They are listed so you do not mistake them for settings.

| Variable | Used by |
| --- | --- |
| `A2A_TEST_POSTGRES_URL` | Database tests (`npm run test:db`) and HTTP verification scripts; a PostgreSQL URL for a disposable test database. |
| `A2A_HTTP_TEST_PROFILE`, `A2A_IDENTITY_HTTP_TEST_PROFILE`, `A2A_HTTP_TEST_KEEP_SERVER` | `scripts/verify-*-http.mjs` |
| `A2A_*_HTTP_TEST_PORT` (`A2A_HTTP_TEST_PORT`, `A2A_AGUI_HTTP_TEST_PORT`, `A2A_A2UI_HTTP_TEST_PORT`, `A2A_FORMS_HTTP_TEST_PORT`, `A2A_DECISIONS_HTTP_TEST_PORT`, `A2A_IDENTITY_HTTP_TEST_PORT`, `A2A_WORKFLOW_HTTP_TEST_PORT`, `A2A_NOTIFICATIONS_HTTP_TEST_PORT`, `A2A_AGENT_APPROVALS_HTTP_TEST_PORT`, `A2A_PHASE6_EXIT_HTTP_TEST_PORT`) | Port overrides for the matching script. |
| `A2A_SERVICE_FIXTURE_DIR` | `scripts/verify-service-security.mjs` |
| `A2A_PACKAGE_TARBALL` | `scripts/verify-package.mjs`: reuse an existing tarball. |

## When it fails

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Invalid database configuration: A2A_DATABASE_URL: ...` | Profile is `postgresql` and the URL is missing or malformed. | Set `A2A_DATABASE_URL` to a `postgresql://` URL. |
| `External command workers require PostgreSQL.` at start | `A2A_COMMAND_WORKER_MODE=external` with PGlite. | Use PostgreSQL, or unset the mode. |
| Every API call returns `503 Identity service unavailable.` | OIDC (or a production default) is selected and a variable is missing, malformed or not HTTPS. | Check the table above; all of issuer, origin, client ID, client secret, organization slug and a 64-hex flow key are required. |
| `Agent target is not in the configured origin allowlist.` | The agent, its interface URL or an OAuth token endpoint has an origin that is not listed. | Add the exact origin to `A2A_ALLOWED_AGENT_ORIGINS`. |
| `Agent network address is blocked.` | The target resolves to a private, loopback or reserved address. | For private or loopback targets, set `A2A_ALLOW_PRIVATE_NETWORKS=true`. Reserved ranges can never be allowed. |
| `Credential vault unavailable.` | `A2A_VAULT_KEYS` or `A2A_VAULT_ACTIVE_KEY` is missing or malformed, or the credential was encrypted with a key that is no longer in the ring. | Fix the ring; restore the old key if it was removed. |
| Relative paths seem to point somewhere unexpected | Data paths resolve against the process working directory. | Use absolute paths in production. |

## Limits

- There is no runtime reload. Restart to apply a change.
- There is no validation command that checks the whole environment at once; errors appear when a component first reads its variables.
- Worker timings and rate limits are not configurable. See [HTTP API](http-api.md#rate-limits) for the fixed limits.

## Related

- [CLI reference](cli.md)
- [Production deployment](../guides/production-deployment.md)
- [Sign in and roles](../guides/sign-in-and-roles.md)
- [Compatibility](compatibility.md)
