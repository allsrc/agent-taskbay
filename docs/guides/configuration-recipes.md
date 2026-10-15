# Configuration recipes

> Who this is for: operators and developers who want a working set of `A2A_*` variables for a common setup without reading every row of the reference. You will have a copy-pasteable environment for your case, the commands to start it, and a check that tells you it is working.

Agent Taskbay is configured only by environment variables. Each recipe below lists the variables for one setup, explains the lines that are not obvious, and links to the
[configuration reference](../reference/configuration.md), which is the full list with every default and valid value. Taskbay is pre-1.0 (version 0.2.0): variable names and
defaults may change between minor versions, so check the [CHANGELOG](../../CHANGELOG.md) when you upgrade.

| Recipe | Database | Sign-in | Safe on a shared network |
| --- | --- | --- | --- |
| [1. Local evaluation with `npx`](#1-local-evaluation-with-npx) | PGlite | Development administrator | No |
| [2. Local from source](#2-local-from-source-with-npm-run-dev) | PGlite | Development administrator | No |
| [3. Single server on PostgreSQL with OIDC](#3-single-server-on-postgresql-with-oidc) | PostgreSQL | OIDC | Yes |
| [4. PostgreSQL with separate workers](#4-postgresql-with-separate-worker-processes) | PostgreSQL | OIDC | Yes |
| [5. Agents on a private network](#5-agents-on-a-private-network) | Adds to 3 or 4 | | Yes, with a tight allowlist |
| [6. Protected agents](#6-protected-agents) | Adds to any | | Yes |
| [7. Notification webhook and agent push](#7-notification-webhook-and-agent-push) | Adds to 3 or 4 | | Yes |
| [8. The experimental AG-UI adapter](#8-the-experimental-ag-ui-adapter) | Adds to any | | Experimental |
| [9. Limit, allow or turn off task discovery](#9-limit-allow-or-turn-off-task-discovery) | Adds to any | | Yes |

## Before you start

- Node.js 22.19.0 or newer (`engines` in `package.json`).
- Know how your process gets its environment. `npx agent-taskbay` reads only your shell. `npm run dev`, `npm start`, `npm run worker:tasks`,
  `npm run security:credentials` and `npm run db:projections:rebuild` also read the `.env*` files Next.js loads from the working directory.
  `npm run auth:provision`, `npm run db:migrate` and the other migration scripts read only the shell. The full table is in
  [How values are loaded](../reference/configuration.md#how-values-are-loaded).
- Values are read when a process starts. After any change, restart every web and worker process.
- Generate each 64-hex-character value (flow key, vault key, push signing key) separately with `openssl rand -hex 32`. Do not reuse one value for two purposes.
- Never put a secret in a `NEXT_PUBLIC_*` variable. Nothing in Taskbay reads one, and Next.js would send it to browsers.

The server recipes (3 to 7) keep variables in one file outside the repository and load it into the shell before each command, so that the scripts that do not read
`.env` files see the same values. Quote JSON values with single quotes, as shown, so the shell keeps the double quotes inside them.

## 1. Local evaluation with `npx`

Use this to try the console on your own machine. It needs no variables and no checkout.

**Unsafe on a shared network.** Every request is signed in as an administrator. The launcher refuses to bind a non-loopback address unless OIDC is configured.

```bash
npx agent-taskbay
```

In a second terminal, start the sample agents:

```bash
npx agent-taskbay demo-agent
```

Optional overrides. The launcher reads only your shell, so export them before you run it. Values you set always win over the
[launcher defaults](../reference/configuration.md#launcher-defaults):

```bash
export PORT=3010
export A2A_DATA_DIR="$HOME/taskbay-eval"
export A2A_REGISTERED_AGENTS=http://127.0.0.1:4010/showcase/card.json
```

- `PORT` is the port when you do not pass `--port` ([process variables](../reference/configuration.md#process-variables)). The default is `3002`.
- `A2A_DATA_DIR` holds the database, artifacts, `secrets.json` and the pid file; `--data-dir` does the same and wins ([database and storage](../reference/configuration.md#database-and-storage)). The default is `~/.agent-taskbay`.
- `A2A_REGISTERED_AGENTS` seeds the catalog with Agent Card URLs that cannot be removed from the UI ([catalog and extensions](../reference/configuration.md#catalog-and-extensions)).

Or pass flags instead:

```bash
npx agent-taskbay --port 3010 --data-dir ./taskbay-eval --no-open
```

**Check it works.** The launcher prints a banner once the server answers. Observed from `node bin/agent-taskbay.mjs -p 3077` in a checkout (the same file `npx`
runs; without `-p` the port is 3002):

```text
  Agent Taskbay 0.2.0 is running at http://127.0.0.1:3077
  Data: <your data dir>
  Local mode: you are signed in as a development administrator. Only this machine can connect.
  Try it with sample agents: npx agent-taskbay demo-agent
```

```bash
curl -i http://127.0.0.1:3002/api/auth/session
```

Use your port if you changed it. A `200` with `"mode":"development"` in the body (observed) means the server, the database and local identity are working. The rest of the walk-through is in the
[quickstart](../quickstart.md).

Do not delete `secrets.json` in the data directory. It holds the generated vault key, and without it stored agent credentials cannot be decrypted.

## 2. Local from source with `npm run dev`

Use this to develop Taskbay or to test an agent you are writing. **Unsafe on a shared network**, for the same reason as recipe 1.

With no variables, `npm run dev` uses PGlite in `./.data`, applies migrations on start, signs you in as a development administrator and allows private and loopback
agents. To test agent credentials you also need a vault key ring. Put this in `.env.local` in the checkout:

```bash
A2A_REGISTERED_AGENTS=http://127.0.0.1:4010/showcase/card.json
A2A_VAULT_KEYS='{"dev-1":"<64 hex characters>"}'
A2A_VAULT_ACTIVE_KEY=dev-1
```

- `A2A_REGISTERED_AGENTS` adds the sample agent to the catalog on every start ([catalog and extensions](../reference/configuration.md#catalog-and-extensions)).
- `A2A_VAULT_KEYS` is the key ring that encrypts agent credentials; the launcher generates one, `npm run dev` does not ([agent credentials and card trust](../reference/configuration.md#agent-credentials-and-card-trust)).
- `A2A_VAULT_ACTIVE_KEY` names the key in the ring used for new credentials.

Do not copy `.env.example` to `.env.local` unchanged. It sets `A2A_ALLOW_PRIVATE_NETWORKS=false`, which blocks the sample agents on `127.0.0.1` even in development
([outbound network policy](../reference/configuration.md#outbound-network-policy)). Delete that line or set it to `true`.

Start the console and, in a second terminal, the sample agents:

```bash
npm run dev
```

```bash
node scripts/fixture-form-agent.mjs 4010
```

**Check it works.** `npm run dev` listens on port 3002.

```bash
curl -i http://localhost:3002/api/auth/session
```

A `200` with `"mode":"development"` means you are signed in as the local administrator. Open `http://localhost:3002/agents`; the sample agent is listed.

Only one process may open the PGlite directory. Stop `npm run dev` before running a script against it with `--offline-pglite`.

## 3. Single server on PostgreSQL with OIDC

Use this for a small shared deployment: one web process that also runs the background loops, a PostgreSQL database, and people signing in through your OpenID Connect
provider. It needs a source checkout, because the migration and provisioning scripts are not in the npm package. The full procedure, including the reverse proxy, is in
[Production deployment](production-deployment.md).

Write `taskbay.env` outside the repository, replacing every placeholder:

```bash
NODE_ENV=production
A2A_DATABASE_PROFILE=postgresql
A2A_DATABASE_URL=postgresql://taskbay:CHANGE_ME@db.internal:5432/taskbay
A2A_AUTO_MIGRATE=false
A2A_ARTIFACT_DATA_DIR=/var/lib/agent-taskbay/artifacts

A2A_AUTH_MODE=oidc
A2A_AUTH_ORIGIN=https://taskbay.example.com
A2A_OIDC_ISSUER=https://idp.example.com
A2A_OIDC_CLIENT_ID=agent-taskbay
A2A_OIDC_CLIENT_SECRET=CHANGE_ME
A2A_AUTH_ORGANIZATION_SLUG=acme
A2A_AUTH_FLOW_KEY=<64 hex characters>

A2A_ALLOWED_AGENT_ORIGINS=https://agents.example.com
A2A_VAULT_KEYS='{"key-1":"<64 hex characters>"}'
A2A_VAULT_ACTIVE_KEY=key-1
```

- `NODE_ENV=production` turns on the production rules: OIDC by default, a required allowlist, HTTPS-only agents, private networks blocked ([process variables](../reference/configuration.md#process-variables)).
- `A2A_AUTO_MIGRATE=false` keeps migrations an explicit step with `npm run db:migrate` ([database and storage](../reference/configuration.md#database-and-storage)).
- `A2A_ARTIFACT_DATA_DIR` should be an absolute path; relative paths resolve against the working directory. Back it up with the database.
- `A2A_AUTH_ORIGIN` is the exact HTTPS origin browsers use; register `<origin>/api/auth/callback` with your provider ([authentication](../reference/configuration.md#authentication-people)).
- `A2A_AUTH_ORGANIZATION_SLUG` is the one organization everyone signs in to; provision people into the same slug.
- `A2A_AUTH_FLOW_KEY` encrypts the 10-minute login state; it is a different value from the vault key.
- `A2A_ALLOWED_AGENT_ORIGINS` lists every exact origin Taskbay may call; with it empty in production, every agent is rejected ([outbound network policy](../reference/configuration.md#outbound-network-policy)).
- `A2A_VAULT_KEYS` and `A2A_VAULT_ACTIVE_KEY` encrypt agent credentials; back them up separately from the database ([agent credentials and card trust](../reference/configuration.md#agent-credentials-and-card-trust)).

Install and build **before** you load the file. With `NODE_ENV=production` in the shell, `npm ci` skips development dependencies, and the scripts need `tsx` and the
MikroORM CLI from them.

```bash
npm ci
```

```bash
npm run build
```

```bash
chmod 600 taskbay.env
```

Load the file into the current shell. Run this in every shell you use for the commands below:

```bash
set -a && . ./taskbay.env && set +a
```

```bash
npm run db:migrate
```

```bash
npm run auth:provision -- --issuer https://idp.example.com --subject EXACT_SUBJECT --organization acme --name "Ada Lovelace" --role admin
```

```bash
npm start -- -H 127.0.0.1
```

`npm start` runs `next start -p 3002`. `-H 127.0.0.1` keeps it on loopback behind a reverse proxy on the same host. With the default
`A2A_COMMAND_WORKER_MODE=embedded`, the background loops run inside this process ([workers](../reference/configuration.md#workers)).

**Check it works.** Through the public origin:

```bash
curl -i https://taskbay.example.com/api/auth/session
```

A `401` with `Sign in to continue.` means the web process is up, the database answers and OIDC is configured. A `503` means a configuration or database problem; see
[When it fails](#when-it-fails). Then sign in in a browser, register an agent and send it a message.

## 4. PostgreSQL with separate worker processes

Use this when you want the web process to serve only the UI and API, and to run the agent-facing loops (dispatch, streams, push, reconciliation, approvals,
notifications) in their own processes. Start from recipe 3 and add one line to `taskbay.env`:

```bash
A2A_COMMAND_WORKER_MODE=external
```

- `A2A_COMMAND_WORKER_MODE=external` stops the web process from starting any loops; you must run a worker, or messages are accepted and never sent ([workers](../reference/configuration.md#workers)).

Two worker scripts exist, and they run the same file, `scripts/command-worker.ts`: `npm run worker:tasks` and its older name `npm run worker:commands`. The worker
always runs every loop. You can run more than one; they share work through database leases.

Load the same file in each shell, then start web and worker:

```bash
set -a && . ./taskbay.env && set +a
```

```bash
npm start -- -H 127.0.0.1
```

```bash
npm run worker:tasks
```

- The worker must see `NODE_ENV=production` itself. It runs under `tsx`, which does not set it; without it the worker applies development network rules to its outbound calls. Loading `taskbay.env` covers this.
- The worker needs the same database URL, artifact directory, allowlist, vault keys, and push and notification settings as the web process. On another host, mount the same artifact directory.
- The worker never applies migrations. Run `npm run db:migrate` before starting a new version.

**Check it works.** A healthy worker prints nothing. Then:

1. Stop the worker and send a message to an agent. The send is accepted with `202` and a command ID.
2. `GET /api/commands/<id>` shows `status: "pending"`.
3. Start the worker again. The status moves to `dispatching`, then `succeeded`.

A line such as `Command dispatcher could not access durable state; will retry.` that keeps repeating means the worker cannot reach PostgreSQL or the schema is not
migrated. More in [Running and workers](../operations/running-and-workers.md).

## 5. Agents on a private network

Use this when your agents run on internal hostnames or private addresses (`10.x`, `172.16.x` to `172.31.x`, `192.168.x`, unique-local IPv6, or loopback) and Taskbay
runs as a production build. Add to the file from recipe 3 or 4:

```bash
A2A_ALLOWED_AGENT_ORIGINS=https://billing-agent.corp.internal,https://search-agent.corp.internal:8443
A2A_ALLOW_PRIVATE_NETWORKS=true
```

- `A2A_ALLOWED_AGENT_ORIGINS` lists exact origins only (scheme, host and port, no path). Include the Agent Card origin, every interface origin the card advertises, each OAuth token endpoint origin, and the notification webhook origin ([outbound network policy](../reference/configuration.md#outbound-network-policy)).
- `A2A_ALLOW_PRIVATE_NETWORKS=true` lets targets resolve to private, unique-local and loopback addresses. Link-local, cloud metadata, multicast and other reserved ranges stay blocked.

Carrier-grade NAT addresses (`100.64.0.0/10`, used by some overlay VPNs) are not in the private ranges and stay blocked even with this setting. Reach such agents
through a hostname that resolves to a private address instead.

Keep the allowlist as short as possible. It is what stops a person who can register agents from making the server call any internal address. Production builds still
require HTTPS, so the internal agents need certificates that Node.js trusts. Node.js's own `NODE_EXTRA_CA_CERTS` variable is the usual way to add a private certificate
authority; it is not read by Taskbay and has not been tested with it.

You do not need this recipe for `npm run dev` (private networks are allowed outside production) or for the `npx` launcher in local mode (it sets
`A2A_ALLOW_PRIVATE_NETWORKS=true` unless you set it).

Restart web and every worker after the change.

**Check it works.** In **Agents**, choose **Add agent**, paste the internal Agent Card URL and choose **Fetch Agent Card**. You see the card instead of an error. A refusal
names the rule: `Agent target is not in the configured origin allowlist.`, `Production agent targets require HTTPS.` or `Agent network address is blocked.`

## 6. Protected agents

Use this when an agent requires authentication (API key, bearer token, OAuth client credentials or mutual TLS), and optionally when you want to accept only signed Agent
Cards. Recipes 2 and 3 already contain a vault key ring, and the `npx` launcher generates one, so you may only need the last two lines:

```bash
A2A_VAULT_KEYS='{"key-2026-10":"<64 hex characters>"}'
A2A_VAULT_ACTIVE_KEY=key-2026-10
A2A_TRUSTED_CARD_KEYS='[{"origin":"https://agents.example.com","kid":"agent-key-1","expiresAt":"2027-10-01T00:00:00Z","jwk":{"kty":"OKP","crv":"Ed25519","alg":"EdDSA","x":"PUBLIC_KEY_BASE64URL"}}]'
A2A_REQUIRE_SIGNED_CARDS=true
```

- `A2A_VAULT_KEYS` maps key IDs (1 to 64 letters, digits, `_` or `-`) to 64-hex-character keys; required to store or use any credential ([agent credentials and card trust](../reference/configuration.md#agent-credentials-and-card-trust)).
- `A2A_VAULT_ACTIVE_KEY` is the key used for new and re-encrypted credentials. Keep retired keys in the ring until every binding is re-encrypted.
- `A2A_TRUSTED_CARD_KEYS` is optional. It pins public keys per Agent Card origin; an expired pin is ignored, and keys advertised inside a card are never fetched.
- `A2A_REQUIRE_SIGNED_CARDS=true` is optional. It refuses any agent whose card does not verify against a pin. Without it, unsigned cards are accepted, but signed cards that fail or have no pin are still refused.

Share the same ring with web and every worker, then restart them. The credential itself is not a variable: store it with the CLI. Write the binding to a file only you can
read (shapes for each credential type are in [Agent credentials](agent-credentials.md#credential-kinds)):

```json
{
  "origins": ["https://agents.example.com"],
  "credential": { "type": "bearer", "token": "REPLACE_WITH_THE_TOKEN" }
}
```

```bash
chmod 600 binding.json
```

```bash
npm run security:credentials -- --organization acme --agent AGENT_UUID --action store < binding.json
```

```bash
rm binding.json
```

`AGENT_UUID` is the agent's local ID, the `id` field of `GET /api/agents`. With PGlite, stop the web process and add `--offline-pglite`. For an `oauthClient`
credential, also add the token endpoint's origin to `A2A_ALLOWED_AGENT_ORIGINS`.

**Check it works.** The CLI prints `Agent credential binding updated.` In **Settings**, section **Agent credentials** shows the kind and that it is enabled (never the
secret). Open the agent in the catalog and run discovery: you see the card instead of `Agent credentials are required.` or `Agent credential destination is not permitted.`
With trust pins, a card that fails the policy is refused with `Agent Card trust policy rejected this connection.` Rotation and revocation are in
[Agent credentials](agent-credentials.md).

## 7. Notification webhook and agent push

These are two independent options that are often turned on together on a server. The notification webhook sends a signed copy of each in-app notification to one URL
(for example a chat incoming webhook). Agent push lets agents that advertise push notifications call Taskbay back instead of waiting for polling. Add to the file from
recipe 3 or 4:

```bash
A2A_NOTIFY_WEBHOOK_URL=https://hooks.example.com/taskbay
A2A_NOTIFY_WEBHOOK_SECRET=<64 hex characters>
A2A_NOTIFY_WEBHOOK_ORGANIZATION=acme
A2A_ALLOWED_AGENT_ORIGINS=https://agents.example.com,https://hooks.example.com

A2A_PUSH_CALLBACK_ORIGIN=https://taskbay.example.com
A2A_PUSH_SIGNING_KEY=<64 hex characters>
```

- `A2A_NOTIFY_WEBHOOK_URL` may not contain credentials, a query string or a fragment; its origin must be in the allowlist ([notifications](../reference/configuration.md#notifications)).
- `A2A_NOTIFY_WEBHOOK_SECRET` must be at least 32 characters; it signs each request in `X-Agent-Taskbay-Signature`. `openssl rand -hex 32` gives a suitable value.
- `A2A_NOTIFY_WEBHOOK_ORGANIZATION` defaults to `local`; with OIDC set it to your `A2A_AUTH_ORGANIZATION_SLUG`, or nothing is sent.
- `A2A_ALLOWED_AGENT_ORIGINS` replaces the line from recipe 3 and now also lists the webhook origin, because the webhook follows the same outbound rules as agents.
- `A2A_PUSH_CALLBACK_ORIGIN` is the HTTPS origin agents can reach; Taskbay registers `<origin>/api/webhooks/a2a/<registration id>` with them ([workers](../reference/configuration.md#workers)).
- `A2A_PUSH_SIGNING_KEY` derives each registration's bearer token; web and workers must have the same value.

Set these on the web process **and** every worker, then restart them. Agents call the push path without a browser session, so do not put your own authentication in front
of `/api/webhooks/a2a/` at the reverse proxy.

For local testing only, a plain HTTP loopback callback is allowed with two more lines. **Not for production**:

```bash
A2A_PUSH_CALLBACK_ORIGIN=http://127.0.0.1:3002
A2A_PUSH_ALLOW_LOOPBACK_HTTP=true
```

**Check the webhook.** Sign in as an administrator, open **Settings**, find **Notification channel** and choose **Send test notification**. The card shows "On" with the
webhook host and a delivered count; `GET /api/notifications/channel` returns `"configured":true` and `"enabledForOrganization":true`. How to verify the signature on the
receiving side is in [Notifications](notifications.md#verify-the-signature).

**Check push.** Send an unauthenticated request to a made-up registration ID:

```bash
curl -i -X POST https://taskbay.example.com/api/webhooks/a2a/00000000-0000-4000-8000-000000000000 -H 'Content-Type: application/json' -d '{}'
```

A `401` with `{"error":"Invalid push authentication."}` means the web process has push configured (observed on a local build with a loopback callback). A `503` with
`Push delivery is not configured.` means the web process does not have `A2A_PUSH_CALLBACK_ORIGIN`. Push is only registered for agents whose card advertises push
notifications; for other agents, streaming and polling still keep tasks up to date. The full push procedure and its errors are in [Receive push callbacks from agents](agent-push-callbacks.md).

## 8. The experimental AG-UI adapter

Use this when an AG-UI client should drive an A2A agent through Taskbay. **Experimental**: it has not been verified against a real AG-UI client library or the official
schema, it refuses cross-origin browser clients, and runs end after 50 seconds. Read the [AG-UI adapter reference](../reference/ag-ui.md) before relying on it.

```bash
A2A_AGUI_ENABLED=true
```

- `A2A_AGUI_ENABLED` must be exactly `true`; `1` or `TRUE` leave it off ([catalog and extensions](../reference/configuration.md#catalog-and-extensions)).

Add the line to `.env.local` (recipe 2), your shell (recipe 1) or `taskbay.env` (recipes 3 and 4), then restart the web process.

**Check it works.** Against a local development server, with `AGENT_ID` from `GET /api/agents`:

```bash
curl -N -X POST http://127.0.0.1:3002/api/agents/AGENT_ID/ag-ui -H 'Content-Type: application/json' -d '{"threadId":"t1","runId":"r1","messages":[{"id":"u1","role":"user","content":"hello"}]}'
```

An event stream that starts with `RUN_STARTED` means it works. `404` with `The AG-UI adapter is not enabled.` means the variable is not `true` in the web process.
`404` with `Unknown agent.` means the adapter is on and the agent ID is wrong (observed on a local build). With OIDC, the request also needs a session cookie and an
`Origin` header equal to `A2A_AUTH_ORIGIN`. A full first run, including answering an interrupt, is in [Try the AG-UI adapter](enable-ag-ui.md).

## 9. Limit, allow or turn off task discovery

Use this when people should not be able to see tasks other systems started on an agent, because the agent's credential is shared and can list more than they should see.
By default Taskbay lets people with access to the whole agent **browse** an agent's tasks and track the ones they choose ([Task discovery](connect-an-agent.md#task-discovery)).

```bash
A2A_TASK_DISCOVERY=off
```

- `off` forbids listing agent tasks anywhere in the deployment. `browse` (the default) allows browsing and tracking. `auto` also allows an administrator to set an agent to automatic discovery.
- The value is the highest mode any agent may use; an agent's own setting is lowered to it, never raised ([Catalog and extensions](../reference/configuration.md#catalog-and-extensions)). Anything else stops start-up with `Invalid task discovery configuration: A2A_TASK_DISCOVERY must be one of off, browse, auto.`

To let administrators switch agents to **automatic** discovery (opt-in, per agent), set the cap to `auto`:

```bash
A2A_TASK_DISCOVERY=auto
```

Nothing starts by itself: each agent stays on Browse only until an administrator chooses **Automatic** on its page. The worker (embedded, or `npm run worker:tasks`) does the sweeping,
so it needs the same variable ([Workers](../reference/configuration.md#workers)).

Add the line to `.env.local` (recipe 2), your shell (recipe 1) or `taskbay.env` (recipes 3 and 4), then restart the web process (and the worker, if you run one).

**Check it works.** Open an agent's page: the **Task discovery** card says "This deployment allows up to off." beside the modes it forbids, and `GET /api/agents/AGENT_ID/discovery` returns `"cap": "off"`.

## When it fails

Taskbay has no command that checks the whole environment at once. Each component reports its own variables when it first reads them, at start or on first use.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Invalid database configuration: A2A_DATABASE_PROFILE: ...` | The profile is not `pglite` or `postgresql`. | Use one of the two values. |
| `Invalid database configuration: A2A_DATABASE_URL: A2A_DATABASE_URL is required for the postgresql profile` | Profile is `postgresql`, URL missing in this process. Often `db:migrate` or `auth:provision` run in a shell that did not load the file. | Load the file in that shell, or set the URL. |
| `... A2A_DATABASE_URL must use the postgres or postgresql protocol` or `... must be a valid PostgreSQL URL` | Malformed URL. | Use `postgresql://user:password@host:5432/database`. |
| `External command workers require PostgreSQL.` at web start | `A2A_COMMAND_WORKER_MODE=external` with PGlite. | Use PostgreSQL, or remove the mode. |
| `Invalid A2A_COMMAND_WORKER_MODE.` | Value is not `embedded` or `external`. | Fix the value. |
| `The separate worker requires PostgreSQL; PGlite uses embedded dispatch.` | The worker's shell does not have `A2A_DATABASE_PROFILE=postgresql`. | Load the same file before `npm run worker:tasks`. |
| Messages are accepted but stay `pending` | External mode with no worker running. | Start `npm run worker:tasks`. |
| Every API call answers `503 Identity service unavailable.` | OIDC (the production default) with a missing or malformed value, a non-HTTPS issuer or origin, or no database. | Check all six OIDC variables and the 64-hex flow key; see [Sign in and roles](sign-in-and-roles.md#when-it-fails). |
| `Agent target is not in the configured origin allowlist.` | An agent, interface, token endpoint or webhook origin is not listed. | Add the exact origin to `A2A_ALLOWED_AGENT_ORIGINS`. |
| `Agent allowlist entries must be exact origins.` | An allowlist entry has a path. | Remove the path, keep scheme, host and port. |
| `Production agent targets require HTTPS.` | An `http://` agent on a production build. | Serve the agent over HTTPS. |
| `Agent network address is blocked.` | The target resolves to a private or loopback address without `A2A_ALLOW_PRIVATE_NETWORKS=true`, or to a reserved range that is never allowed. | Recipe 5 for private and loopback targets. |
| `Credential vault unavailable.` | `A2A_VAULT_KEYS` is empty, a key ID or key has the wrong format (a key must be 64 hex characters), the active key is not in the ring, or the key a binding used was removed. | Fix the ring; restore the removed key. |
| `Agent credentials are required.` | The card declares security and the agent has no binding. | Recipe 6. |
| `Agent Card trust policy rejected this connection.` | A signed card has no matching unexpired pin, or `A2A_REQUIRE_SIGNED_CARDS=true` and the card is unsigned. | Add or renew the pin in `A2A_TRUSTED_CARD_KEYS`, or drop the requirement. |
| `A2A_PUSH_SIGNING_KEY must contain 64 hexadecimal characters.` | Callback origin set, key missing or malformed. | Generate with `openssl rand -hex 32`. |
| `A2A_PUSH_CALLBACK_ORIGIN requires an HTTPS origin (or explicitly enabled loopback HTTP).` | The callback has a path, credentials, a query, or plain HTTP. | Use `https://host` with no path. |
| Agents get `503 Push delivery is not configured.` | Push is set on the worker but not on the web process. | Give web the same push variables and restart it. |
| Log shows `A2A_NOTIFY_WEBHOOK_SECRET must be at least 32 characters when A2A_NOTIFY_WEBHOOK_URL is set.` | Short or missing secret. In-app notifications still work. | Use 32 or more characters. |
| The channel card says "Configured for another organization" | `A2A_NOTIFY_WEBHOOK_ORGANIZATION` is not your slug. | Set it to `A2A_AUTH_ORGANIZATION_SLUG`. |
| `404 The AG-UI adapter is not enabled.` | `A2A_AGUI_ENABLED` is not exactly `true`. | Set `true` and restart. |
| `agent-taskbay: Agent Taskbay is already running for <dir> (pid ..., ...)` | A second launcher on the same data directory. | Stop the first, or pass `--data-dir`. |
| `agent-taskbay: Local mode signs everyone in as an administrator, so it cannot listen on <host>. ...` | `--host` is not a loopback address and OIDC is not configured. | Use `127.0.0.1`, or configure OIDC. |
| `npm run worker:tasks` or `db:migrate` cannot find `tsx` or `mikro-orm` | `npm ci` ran with `NODE_ENV=production` in the shell and skipped development dependencies. | Run `npm ci` in a shell without the file loaded. |

More messages: [Troubleshooting](../operations/troubleshooting.md).

## Limits

- No runtime reload. Restart every process after a change.
- No validation command for the whole environment; errors appear as each component reads its variables.
- Recipes 3, 4, 5 and 7 have not been run end to end against a real PostgreSQL server and identity provider for this page. The individual responses marked "observed" were
  checked on a local production build.
- One organization per deployment. The worker loops, timings and rate limits are not configurable.
- The npm package does not include the operator scripts (`db:migrate`, `auth:provision`, `security:credentials`, `worker:tasks`). Server recipes need a source checkout.
- Pre-1.0: variable names keep the `A2A_` prefix and may be renamed ([#27](https://github.com/allsrc/agent-taskbay/issues/27)).

## Related

- [Configuration reference](../reference/configuration.md)
- [Production deployment](production-deployment.md)
- [Running and workers](../operations/running-and-workers.md)
- [Agent credentials](agent-credentials.md)
- [CLI reference](../reference/cli.md)
