# Connect an agent

> Who this is for: an administrator adding an A2A agent to Agent Taskbay. At the end the agent is registered, reachable, authenticated if it needs to be, and visible to the people who should be able to use it.

Connecting an agent is three separate things: registering its Agent Card URL, giving the console a credential if the agent requires one, and granting people access. Registration is a browser action. Credentials are set on the server, never in the browser. Grants are set in Settings.

## Before you start

- You are signed in as an administrator. Registering agents, previewing cards, and managing grants are administrator-only. Operators and viewers can only see agents they have been granted.
- The agent publishes an A2A Agent Card over HTTP(S). The console speaks JSON-RPC and HTTP+JSON (REST) through the A2A JavaScript SDK (`@a2a-js/sdk`, `^1.3.0` in `package.json`). gRPC interfaces are ignored: the hardened network policy rejects them because the SDK gRPC factory cannot be bound to the console's address checks.
- In production builds, the allowlist and network rules in [Restrictions on where agents may live](#restrictions-on-where-agents-may-live) are satisfied.

## Register an agent from its Agent Card

### 1. Find the Agent Card URL

Use the full URL of the card. If you give a URL ending in `.json`, the console fetches exactly that. Otherwise it tries, in order, `.well-known/agent-card.json` relative to what you gave, `/.well-known/agent-card.json` at the origin, and the URL as given. The card must be 2 MB or smaller. The URL may not contain credentials, a query string or a fragment, and may be at most 1024 characters.

For the sample agents, the paths are `http://127.0.0.1:4010/<variant>/card.json` (`form`, `plain`, `invalid` printed by `node scripts/fixture-form-agent.mjs 4010`; `showcase`, `approver` and `a2ui` are also served).

### 2. Register it

1. Open **Agents** and choose **Add agent**. The dialog is titled "Connect agent".
2. Paste the URL and choose **Fetch Agent Card**. The console fetches the card without registering it and shows its name, version, skill count, whether it streams, whether it supports push notifications, and its advertised security schemes ("None advertised" if empty).
3. Choose **Continue**, then **Connect**.

If the card is behind authentication, previewing will fail because the preview call sends no credentials. In that case use **Register URL** on the first step, which saves the URL without fetching the card, then configure the credential (next step).

You can also register through the API: `POST /api/agents` with `{"cardUrl": "..."}` returns 201 and the agent record. The call is administrator-only and does not fetch the card, so a wrong URL is registered and then shows up as unreachable. Registering the same URL again returns the existing agent, and re-enables it if it was removed.

An agent can also be seeded from the `A2A_REGISTERED_AGENTS` environment variable (comma-separated card URLs). Those agents cannot be removed in the UI.

### 3. Add a credential if the agent needs one

The console only holds credentials in an encrypted server-side vault. There is no browser form for secrets. An agent whose card lists security requirements, and which has no credential, fails with "Agent credentials are required."

Credential binding kinds (from the schema in `src/server/adapters/auth/credential-schema.ts`):

| Kind | Fields |
| --- | --- |
| `apiKey` | `name` (header name), `value` |
| `bearer` | `token` |
| `oauthClient` | `issuer`, `tokenEndpoint`, `clientId`, `clientSecret`, optional `scope` |
| `mtls` | `cert`, `key` (PEM), optional `ca` |

Every binding also lists `origins`, the exact HTTPS origins the credential may be sent to (1 to 20). It is never sent anywhere else. Pipe the JSON on standard input, not on the command line, using the agent's ID from the Agents list or `/api/agents`:

```bash
npm run security:credentials -- --organization local --agent AGENT_UUID --action store < binding.json
```

With the embedded database, stop the console first and add `--offline-pglite`. The CLI prints no secret values; on failure it prints a generic message. `--action revoke` disables the binding, and later calls to that agent fail instead of falling back to no credential. The full lifecycle (vault keys, rotation, trust pins) is in [Agent credentials](agent-credentials.md).

In local mode the organization slug is `local` (the launcher and `npm run dev` use the default organization; the webhook setting `A2A_NOTIFY_WEBHOOK_ORGANIZATION` also defaults to `local`). For OIDC deployments use the slug in `A2A_AUTH_ORGANIZATION_SLUG`.

### 4. Grant access

Administrators see every agent. Everyone else sees nothing until granted.

1. Open **Settings**, then **Teams and access**.
2. Optionally create a team and add members.
3. Under the grant form choose a recipient (everyone in the organization, one member, or a team), the agent, a scope (whole agent, or one skill), and a permission: **Read** or **Read and operate**. Then **Grant access**.
4. **Revoke** removes it. Revocation applies to later reads and commands. Work the console already accepted continues.

Viewers cannot operate even if a grant says "operate". A grant for one skill only works if the agent advertises and enforces the skill-routing extension. See [Build an agent for Taskbay](build-an-agent-for-taskbay.md#skill-routing). Roles are described in [Sign in and roles](sign-in-and-roles.md).

### 5. Confirm it works

1. On the agent's page, check the cards: **Capabilities** (streaming, push, extended card, extensions), **Interfaces** (binding and URL), **Skills**, **Security** (the card signature status and security schemes).
2. Choose **Start chat** and send a message. The task appears under **Tasks** and in **Inbox**.

From a terminal you can check what the catalog sees:

```bash
curl -s http://localhost:3002/api/agents
```

Each entry has the card, a `trust` value, or an `error` string if discovery failed. In local development mode this works without a login; in OIDC mode it needs a session cookie.

## Task discovery

Other systems can start tasks on an agent you connect: a pipeline, a schedule, a colleague's own client. Taskbay can show you those tasks so you can answer, steer or cancel them.
It does this with the **agent's own credential**, so what you see is what that credential can list, which may include other people's work.

Each agent has a mode, set on its page by an administrator:

| Mode | What Taskbay does | Default |
| --- | --- | --- |
| **Browse only** | Lists the agent's tasks live when someone asks (**Browse tasks**). Nothing is stored. A task is stored, and followed, only when a person **tracks** it. | Yes |
| **Off** | Never lists the agent's tasks. | |
| **Automatic** | Also stores and follows tasks started elsewhere in the background. Not available yet. | |

Who may browse and track: an administrator, or an operator with an `operate` grant on the **whole** agent. A grant limited to one skill never lets someone browse, and never shows a tracked task.
Viewers cannot. A tracked task has no owner and nobody is notified about the state it is already in; see [Browse an agent's tasks](use-the-console.md#browse-an-agents-tasks).

The deployment can lower the highest mode with `A2A_TASK_DISCOVERY` (`off`, `browse` or `auto`, default `browse`; [Configuration](../reference/configuration.md)). The agent page shows "This deployment allows up to …" for modes it forbids.
Every change of mode and every tracked task is recorded in the security audit (`task.discovery.mode_changed.<mode>`, `task.discovery.tracked`).

If the agent does not support listing tasks, browsing says so; you can still track a task by its ID.

## Required extensions

An Agent Card can mark an extension `required: true`. If Taskbay does not understand that extension, the agent cannot be expected to behave correctly, so Taskbay blocks
**sending** to it. Canceling a task is never blocked. Taskbay understands the sideband extensions (the built-in ones and any in `A2A_SIDEBAND_EXTENSION_URIS`), the
structured form, approval request and A2UI extensions, and skill routing ([Extensions](../reference/extensions/README.md)).

What you see:

- The agent page shows a red notice, "This agent requires an extension Taskbay does not support", with the extension addresses as text. The compliance report on the card has an error, `extension.required.unsupported`.
- A send fails with `409` and kind `extension_required`; the response lists the extensions in `error.details.extensions` ([HTTP API](../reference/http-api.md#sending-messages-and-commands)).

To send anyway, an administrator turns on **Allow sending without it (audited)** on the agent page, or calls `PATCH /api/agents/{agentId}/settings` with `{ "extensionOverride": true }`.
The change is recorded in the security audit as `agent.extension.override` (and `agent.extension.override.removed` when turned off). The agent may not behave as it expects.

The check uses the agent's most recent stored card, which Taskbay records whenever the catalog or the agent page loads. A send made before any card was recorded is not blocked.

## Restrictions on where agents may live

These apply in production builds. `npm run dev` allows private addresses by default.

- `A2A_ALLOWED_AGENT_ORIGINS` is a comma-separated list of exact origins (scheme, host, port, no path). In production it is required, and every card, interface, OAuth token endpoint and notification webhook origin must be listed. Targets must use HTTPS.
- Private, loopback and unique-local addresses are blocked unless `A2A_ALLOW_PRIVATE_NETWORKS=true`. Link-local, metadata and reserved addresses are always blocked. The console resolves DNS itself and checks the addresses it will actually connect to.
- Redirects are rejected.
- The local launcher (`agent-taskbay`) and the `npm run dev` profile are exceptions: they allow any origin until you set an allowlist, and the launcher turns on private networks. Once you set an allowlist it is always enforced.

Card trust: a card is "unsigned" or "verified". Verification uses public keys you pin in `A2A_TRUSTED_CARD_KEYS`. Set `A2A_REQUIRE_SIGNED_CARDS=true` to refuse unsigned cards. Trust does not grant any user access. Details are in [Agent credentials](agent-credentials.md).

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| "Agent network request failed." in the dialog or on the agent row | Unreachable host or port, TLS failure, or a timeout | Open the card URL with `curl` from the machine running the console. |
| "Agent target is not in the configured origin allowlist." | `A2A_ALLOWED_AGENT_ORIGINS` is set (or you are in production) and the card, interface or token origin is missing from it | Add the exact origin, restart. |
| "Production agent targets require HTTPS." | Production build with an `http:` target | Use HTTPS, or for local trials use the launcher's local mode. |
| "Agent network address is blocked." | The host resolves to a private, loopback, link-local or reserved address | For private addresses set `A2A_ALLOW_PRIVATE_NETWORKS=true`. Link-local and metadata addresses cannot be allowed. |
| "gRPC transport is unavailable under the hardened network policy; advertise an HTTP binding." | The card only offers gRPC | Add a JSON-RPC or HTTP+JSON interface to the card. |
| "Agent Card exceeds the 2 MB safety limit." | Oversized card | Trim the card. |
| "Agent credentials are required." | The card lists security requirements and no credential is stored | Store a binding with `npm run security:credentials`. |
| "Agent Card trust policy rejected this connection." | `A2A_REQUIRE_SIGNED_CARDS=true` and the card is unsigned or its signature does not verify | Pin the signing key, or turn the requirement off. |
| Sending fails with `extension_required` | The card marks an extension `required: true` that Taskbay does not support | Ask the agent's owner, or have an administrator allow it ([Required extensions](#required-extensions)). |
| The agent is registered but a member sees nothing | No grant | Add a grant in Settings. |
| Preview of a protected card fails, though the URL is right | Preview sends no credentials | Use **Register URL**, then store the credential. |
| Remove is missing | The agent was seeded from `A2A_REGISTERED_AGENTS` | Remove it from the variable. |

## Limits

- Credentials are service-level: the console calls the agent as itself. Per-user delegated OAuth is not implemented ([#1](https://github.com/allsrc/agent-taskbay/issues/1)).
- Removing an agent disables it and keeps its history; it does not delete tasks.
- gRPC is not supported.
- The gateway enables the SDK's legacy-compatibility mode for both transports, and the repository's fixtures use protocol version 1.0 cards. Third-party agents are not tested. See [Compatibility](../reference/compatibility.md) for what is verified.

## Related

- [Agent credentials](agent-credentials.md): vault keys, rotation, trust pins, mTLS.
- [Sign in and roles](sign-in-and-roles.md): who is an administrator, and how teams and grants relate.
- [Build an agent for Taskbay](build-an-agent-for-taskbay.md): what a Taskbay-aware agent advertises.
- [Troubleshooting](../operations/troubleshooting.md)
