# Sign in and roles

> For operators who need people to sign in to Agent Taskbay. At the end you will have OIDC sign-in working, a first administrator provisioned, and teams and grants set up.

Agent Taskbay has two ways to identify a person: a local development administrator (no sign-in, loopback only), and OpenID Connect (OIDC) for everything else. This page covers both, the three roles,
and how access to agents is granted. How agents authenticate to Taskbay's outbound calls is a separate subject: see [Agent credentials](./agent-credentials.md).

The package is pre-1.0 (version 0.1.0). It is on npm (`npx agent-taskbay`), and running from a source checkout also works. Settings described
here may change between minor versions.

## Before you start

- A running console. From a source checkout: `npm ci`, then `npm run dev` (port 3002). For a production build see [Production deployment](./production-deployment.md).
- For OIDC: an HTTPS OIDC provider that issues RS256-signed ID tokens, can register a confidential client (the console authenticates with the client secret in the request body), and a canonical
  HTTPS origin for the console. Plain HTTP is not accepted for the console origin in OIDC mode; the session cookie is `Secure` and `__Host-` prefixed.
- Node 22.19.0 or later (`engines` in `package.json`).

## Local development identity

| How you run it | Who you are |
|---|---|
| `npm run dev` | A development administrator named "Local operator" in the organization with slug `local`. No sign-in page. |
| `npx agent-taskbay` | The same identity. The launcher refuses to bind to a non-loopback address unless OIDC is configured. |
| Production build (`npm run build` then `npm start`) | Fails closed unless you set **both** `A2A_AUTH_MODE=development` and `A2A_ALLOW_DEVELOPMENT_AUTH=true`, or configure OIDC. |

Local mode means every request is an administrator. Use it only on a machine you alone control. Setting `A2A_AUTH_MODE=development` with `A2A_ALLOW_DEVELOPMENT_AUTH=true` on a network-reachable server
gives everyone who can reach it full administrative access.

A disabled development membership stays disabled; the console does not re-enable it.

## Set up OIDC

1. Pick the console's external origin, for example `https://taskbay.example.com`. It must be an HTTPS origin with no path, query, credentials or fragment.
2. At your provider, create a confidential client and register this redirect URI:

   ```text
   https://taskbay.example.com/api/auth/callback
   ```

3. Generate a flow key: 32 random bytes as 64 hexadecimal characters. This key encrypts the temporary login state. It is separate from the vault keys.

   ```bash
   openssl rand -hex 32
   ```

4. Set the server environment (web process; never a `NEXT_PUBLIC_*` variable):

   | Variable | Value |
   |---|---|
   | `A2A_AUTH_MODE` | `oidc` (this is also the default when `NODE_ENV=production`) |
   | `A2A_AUTH_ORIGIN` | `https://taskbay.example.com` |
   | `A2A_OIDC_ISSUER` | The HTTPS issuer URL. Provider discovery runs against it. |
   | `A2A_OIDC_CLIENT_ID`, `A2A_OIDC_CLIENT_SECRET` | From step 2 |
   | `A2A_AUTH_ORGANIZATION_SLUG` | The organization slug people sign in to, for example `acme` |
   | `A2A_AUTH_FLOW_KEY` | The 64 hex characters from step 3. Share the same value across web replicas. |
   | `A2A_AUTH_SESSION_SECONDS` | Optional. Absolute session lifetime, 60 to 86400. Default 28800 (eight hours). |

   The full list, with defaults, is in the [configuration reference](../reference/configuration.md).

5. Provision your first administrator **before** anyone signs in (see below). Nobody is admitted just because the provider authenticated them.
6. Terminate public HTTPS at a reverse proxy you trust and forward to the Node server. The redirect URI comes from `A2A_AUTH_ORIGIN`, never from `Host` or `Forwarded` headers.

### What the sign-in flow does

Authorization code flow with S256 PKCE, `openid profile` scopes, a nonce, and ID-token validation against the provider's keys (RS256). The login attempt lives for 10 minutes and can be used once.
Provider tokens are discarded after validation. Only the issuer and the `sub` claim are kept. Provider email, role, group and organization claims do not grant anything.

Sessions are server-side. The browser holds an opaque cookie (`__Host-a2a-session`, HttpOnly, Secure, SameSite=Lax). Signing out (`POST /api/auth/logout`) deletes the session. Every request re-checks that the
membership and user are still enabled, so disabling someone takes effect on their next request. Work the console already accepted continues in the worker after sign-out.

Mutating requests (`POST`, `PUT`, `DELETE`) must carry an `Origin` header equal to `A2A_AUTH_ORIGIN` in OIDC mode.

## Provision people

Identities are created by an operator on the server, not by a sign-up page:

```bash
npm run auth:provision -- --issuer https://idp.example.com --subject EXACT_SUBJECT --organization acme --name "Ada Lovelace" --role admin
```

| Flag | Meaning |
|---|---|
| `--issuer` | HTTPS issuer URL, no credentials, query or fragment. A trailing slash is removed. It must match `A2A_OIDC_ISSUER` (also without a trailing slash). |
| `--subject` | The provider's `sub` claim for that person, exactly. Up to 255 characters. |
| `--organization` | Organization slug. Created if it does not exist. Must equal `A2A_AUTH_ORGANIZATION_SLUG` for the person to be able to sign in. |
| `--name` | Display name, up to 200 characters. |
| `--role` | `admin`, `operator` or `viewer`. |
| `--offline-pglite` | Required with the PGlite database. Stop the web process first. |

Things to know:

- **The script reads the process environment, not `.env.local`.** Unlike `db:projections:rebuild`, `security:credentials` and `worker:tasks`, `auth:provision` does not load `.env` files. Export
  `A2A_DATABASE_PROFILE` and `A2A_DATABASE_URL` (or `A2A_PGLITE_DATA_DIR`) in the shell.
- With PostgreSQL the command can run while the web process is up. With PGlite only one process may open the data directory, so stop the web process and add `--offline-pglite`.
- Running it again for the same issuer and subject changes the role and sets the membership to enabled. It does not change the display name and does not re-enable a user that was disabled globally.
- There is no administration UI for users and no CLI to disable or remove one. A trusted database operator sets `enabled` to false on the row in `memberships` (or `users` to block a person across
  organizations).
- Output on success is the single line `Identity membership provisioned.`

To find a person's `sub`, read it from your provider's user record or from the ID token. Some providers use opaque identifiers rather than email addresses.

## Roles

| Role | Can do | Cannot do |
|---|---|---|
| `admin` | Everything in the organization: register and remove agents, manage teams and grants, see and operate every agent, view the audit log. | |
| `operator` | Send messages, cancel, claim and assign tasks, decide approvals, only for agents and skills it has been granted `operate` on. | Register agents, manage teams and grants. |
| `viewer` | Read tasks for agents and skills it has been granted. | Any action that changes something, even if a grant says `operate`. |

Roles are baseline. Operators and viewers also need a grant for each agent they should see; with no grant they see nothing. Administrators implicitly have access to everything in their organization.

Request budgets apply per membership per minute: 900 reads, 120 operations, 60 administrative calls. Going over returns HTTP 429.

## Teams and grants

Open **Settings**, section **Teams and access** (administrators only).

1. Create a team and add members.
2. Choose a recipient: everyone in the organization, one person, or a team.
3. Choose an agent and a scope: the whole agent, or a single skill.
4. Choose `Read` or `Read and operate`, then **Grant access**.

Revoking a grant applies to the next read or command. Accepted work already in the worker continues. A skill-only grant lets a person see a reduced view of the agent (its restricted skills) and is only
enforceable for agents that advertise the skill-routing extension; see [Agent credentials](./agent-credentials.md#skill-grants) and the [skill routing reference](../reference/extensions/skill-routing.md).

## When it fails

| Symptom | Likely cause | Fix |
|---|---|---|
| Every API call returns 503 `Identity service unavailable.` | Incomplete or invalid auth configuration, or the database is unreachable. The detail is intentionally not shown to the browser. | Check each variable in the table above: client ID, secret, organization slug, a 64-hex flow key, HTTPS issuer and origin, session seconds in range. In a production build without OIDC, also check `A2A_ALLOW_DEVELOPMENT_AUTH`. |
| `/api/auth/login` returns 503 `Sign-in service unavailable.` | Same as above, or the provider's discovery endpoint was unreachable (10 s timeout). | Fetch `<issuer>/.well-known/openid-configuration` from the server host. |
| After the provider redirect: 401 `Sign-in failed. Start a new sign-in attempt.` | One message covers every callback failure: expired or reused attempt (10 minutes, single use), state or nonce mismatch, token validation failure, or no enabled membership for that `sub` in `A2A_AUTH_ORGANIZATION_SLUG`. | Start again from the login URL. If it repeats, check that the `--issuer` used when provisioning equals `A2A_OIDC_ISSUER`, the subject is exact, and the slug matches. |
| 429 `Too many sign-in requests.` | Login and callback are rate limited to 240 calls per minute each across the whole deployment. | Wait a minute. |
| 401 `Sign in to continue.` | No valid session: expired, signed out, or the membership or user was disabled. | Sign in again. |
| 403 `This action is not permitted.` | Role too low, a missing grant, or a mutating request whose `Origin` does not match `A2A_AUTH_ORIGIN` (the origin failure is reported with the same message). | Check your role and grants. When scripting, send `Origin: <A2A_AUTH_ORIGIN>`. |
| 429 `Too many requests. Try again shortly.` | Per-membership budget exceeded. | Slow down; see budgets above. |
| `Stop web first and explicitly use --offline-pglite for single-owner PGlite.` | You ran `auth:provision` against PGlite without the flag. | Stop the web process and add `--offline-pglite`. |
| `An HTTPS issuer without credentials is required.` | `--issuer` is not HTTPS, or has a user, query or fragment. | Pass the plain issuer URL. |
| `Usage: auth:provision --issuer HTTPS_ISSUER ...` | A required flag is missing or `--role` is not one of the three values. | Re-run with every flag. |
| Provisioned, but no sign-in. The browser never keeps the session. | The cookie is `Secure` and `__Host-` prefixed, so it is dropped over plain HTTP. | Use the HTTPS origin in `A2A_AUTH_ORIGIN` and reach the console only through it. |

## Limits

- One organization per running deployment. `A2A_AUTH_ORGANIZATION_SLUG` selects it; the browser cannot choose.
- Only the OIDC authorization-code profile described above. No SAML, no password login, no API tokens for people, no group or role claim mapping, no SCIM.
- No user administration screen; provisioning is a CLI and deactivation is a database edit.
- Signing in does not give the console credentials to call agents on your behalf. Agent calls use the credentials in the vault. User-delegated OAuth is tracked in
  [#1](https://github.com/allsrc/agent-taskbay/issues/1).
- Not verified: behaviour with any particular identity provider. The test suite uses a temporary local OIDC issuer.

## Further reading

[Decision record: sessions and membership](../archive/adr/0013-plane-a-sessions-and-membership.md).

## Related

- [Agent credentials](./agent-credentials.md)
- [Identity and access concepts](../concepts/identity-and-access.md)
- [Production deployment](./production-deployment.md)
- [Configuration reference](../reference/configuration.md)
