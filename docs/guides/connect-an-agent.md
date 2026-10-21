# Connect an agent

> Who this is for: an administrator adding an A2A agent to Agent Taskbay. At the end the agent is registered, reachable, authenticated if it needs to be, and visible to the people who should be able to use it.

Connecting an agent is three separate things: registering its Agent Card URL, giving the console a credential if the agent requires one, and granting people access. Registration is a browser action. Credentials are set on the server, never in the browser. Grants are set in **Administration**, under **Agent access**.

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

**Nickname.** The first step also has an optional **Nickname**. Card names are whatever each agent advertises, so two agents (or one agent rebuilt in another framework and registered at another address) can show the same name. A nickname is your own name for the registration, such as "Support (LangGraph)". It replaces the card name everywhere in the console, and the agents list shows each agent's host and port under its name. It must be unique among your enabled agents, ignoring case; a removed agent frees its nickname. Administrators can change or clear it later in the **Nickname** card on the agent page. The same card URL is one agent: registering a URL again returns the existing agent, so to run two agents side by side give them different addresses.

If the card is behind authentication, previewing will fail because the preview call sends no credentials. In that case use **Register URL** on the first step, which saves the URL without fetching the card, then configure the credential (next step).

You can also register through the API: `POST /api/agents` with `{"cardUrl": "...", "nickname": "..."}` (nickname optional) returns 201 and the agent record. The call is administrator-only and does not fetch the card, so a wrong URL is registered and then shows up as unreachable. Registering the same URL again returns the existing agent, and re-enables it if it was removed.

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

1. Open **Administration**, then **Teams** to create a team and add people, and **Agent access** to grant.
2. Optionally create a team and add members first.
3. Under the grant form choose a recipient (everyone in the organization, one member, or a team), the agent, a scope (whole agent, or one skill), and a permission: **Read** or **Read and operate**. Then **Grant access**.
4. **Revoke** removes it. Revocation applies to later reads and commands. Work the console already accepted continues.

Viewers cannot operate even if a grant says "operate". A grant for one skill only works if the agent advertises and enforces the skill-routing extension. See [Build an agent for Taskbay](build-an-agent-for-taskbay.md#skill-routing). Roles are described in [Sign in and roles](sign-in-and-roles.md).

### 5. Confirm it works

1. On the agent's page, check the cards: **Capabilities** (streaming, push, extended card, extensions), **Connection** (the interface, protocol version, tenant and extensions this connection uses; see below), **Skills**, **Security** (the card signature status and security schemes).
2. Choose **Start chat** and send a message. The task appears under **Tasks** and in **Inbox**.

#### Reading the Connection card

The **Connection** card shows what Taskbay will use when it talks to the agent. It is read-only and is built from the Agent Card and your saved connection settings.

| Row | Meaning |
| --- | --- |
| **Binding**, **Interface**, **Protocol** | The interface Taskbay connects to. If your connection settings pin a binding, interface URL or protocol version, the card says "Pinned by your connection settings." and shows the matching interface. For the default tenant it shows the interface the A2A SDK picks: bindings in card order, and for each binding the last 1.0 interface, else the first. gRPC is never used. |
| **Tenant** | `(default)` when the card declares no tenant, the tenant when it declares one, or the list when it declares several. |
| **Required** | `All supported`, `None`, or a red `N not supported` pill when the card marks an extension `required: true` that Taskbay does not support (sending is then blocked; see the notice at the top of the page). |
| **Extensions** | Expand it to see each URI as `negotiated` (Taskbay uses it), `ignored` (advertised, not used) or `required, not supported`. |

If **Interface** is `—`, no usable interface is advertised: the card lists only gRPC, or a pinned interface is no longer on the card. Agent-supplied values are shown as text and never as links.

**Tenants.** A tenant is part of a task's identity. When the card declares exactly one tenant, new conversations use it without asking. When it declares several, choose the tenant for a new conversation in the chat **Options** ([Per-request options](use-the-console.md#per-request-options)); an existing conversation keeps the tenant it started with. Taskbay selects the matching advertised interface URL for that tenant, within any pinned connection settings, sends the tenant explicitly and stores it with the task. A tenant that cannot use a matching interface is refused before dispatch. Conversations started before this release may have an empty stored tenant; they keep working, and the agent fills in its default.

From a terminal you can check what the catalog sees:

```bash
curl -s http://localhost:3002/api/agents
```

Each entry has the card, a `trust` value, or an `error` string if discovery failed. In local development mode this works without a login; in OIDC mode it needs a session cookie.

## Extended Agent Card

An agent can advertise an extended card for authenticated callers. On its page, an administrator can choose **Fetch** in the **Extended card** row under **Capabilities**, then **Refresh** to fetch it again. Taskbay uses the agent's stored server-side credential; no credential goes to the browser.

After a successful fetch the row shows **Fetched** and the time. Extra skills appear after public skills with an **Authenticated** pill, and authenticated streaming and push capabilities appear separately. They are information only: chat skill choices, skill grants, required extensions and routing continue to use the public card. People with read access to the whole agent can see the stored display; a skill-only grant does not reveal extra skills.

The `showcase` sample from `npx agent-taskbay demo-agent` supports this flow without a credential and returns an **Authenticated demo skill**. A real agent decides which credential it requires.

**Not configured on this agent** is a neutral result. **Fetch failed** offers **Retry**; check the connection, network policy and signing keys. A failed refresh keeps the last successfully fetched card. Fetching is limited to 30 calls per minute across the deployment, in addition to the administrator's normal budget.

Extended cards pass the same URL, origin, private-network and signature checks as public cards. Their response, including the protocol envelope, is capped at 2 MiB before parsing. Cards with invalid or untrusted signatures are refused; unsigned cards are refused when `A2A_REQUIRE_SIGNED_CARDS=true`.

## Task discovery

Other systems can start tasks on an agent you connect: a pipeline, a schedule, a colleague's own client. Taskbay can show you those tasks so you can answer, steer or cancel them.
It does this with the **agent's own credential**, so what you see is what that credential can list, which may include other people's work.

Each agent has a mode, set on its page by an administrator:

| Mode | What Taskbay does | Default |
| --- | --- | --- |
| **Browse only** | Lists the agent's tasks live when someone asks (**Browse tasks**). Nothing is stored. A task is stored, and followed, only when a person **tracks** it. | Yes |
| **Off** | Disables browsing, tracking and automatic discovery; already stored tasks continue to be followed. | |
| **Automatic** | Also stores and follows tasks started elsewhere, in the background. Opt-in; allowed only when `A2A_TASK_DISCOVERY=auto`. | |

Who may browse and track: an administrator, or an operator with an `operate` grant on the **whole** agent. A grant limited to one skill never lets someone browse, and never shows a tracked task.
Viewers cannot. A tracked task has no owner and nobody is notified about the state it is already in; see [Browse an agent's tasks](use-the-console.md#browse-an-agents-tasks).

The deployment can lower the highest mode with `A2A_TASK_DISCOVERY` (`off`, `browse` or `auto`, default `browse`; [Configuration](../reference/configuration.md)). The agent page shows "This deployment allows up to …" for modes it forbids.
Every change of mode and every tracked task is recorded in the security audit (`task.discovery.mode_changed.<mode>`, `task.discovery.tracked`).

**Automatic mode** lists the agent's tasks on a schedule and stores the ones Taskbay does not know, so work an automated process started appears (and notifies, see
[Notifications](notifications.md#tasks-that-were-started-outside-taskbay)) without anyone browsing. It is deliberately limited: finished tasks are stored only if the agent updated them within
the last **7 days** (an administrator can set 0 to 90 on the agent page; waiting and running tasks are always eligible); at most **500** tasks on the first sweep and **200** on each later one; and at most
**5,000** discovered tasks per agent, after which it **pauses itself** and says so on the agent page until an administrator switches it back on. After the first full read it asks the agent only for what changed
(with a five-minute margin for clock differences) and reads everything again at least once an hour. Tasks it finds have no owner, no skill, and are visible only to people with access to the whole agent.
It runs with the embedded worker on PGlite locally, or with embedded or separate workers on PostgreSQL. Existing tasks continue to refresh in every discovery mode; reconciliation may still use `ListTasks` to refresh known tasks while discovery is Off. See [Running and workers](../operations/running-and-workers.md).

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

Supported advertised extensions are declared in the `A2A-Extensions` request header, including required form, approval and A2UI extensions. Skill routing is activated for a scoped send or when required by the card.

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
| The agent is registered but a member sees nothing | No grant | Add a grant in Administration → Agent access. |
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
