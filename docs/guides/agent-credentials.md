# Agent credentials and outbound policy

> For operators whose agents require authentication, or who run Taskbay outside a trusted laptop. At the end you will know where credentials are stored, how to add, rotate and revoke them, and which outbound network rules apply.

When Taskbay calls an agent it needs to prove who it is to the agent (the "agent credential"), and the server needs rules about where it is allowed to connect. Both are server-side configuration.
There is no browser form for secrets. Settings shows only each binding's status.

This is separate from people signing in, which is covered in [Sign in and roles](./sign-in-and-roles.md).

## Before you start

- The agent is already registered by an administrator (see [Connect an agent](./connect-an-agent.md)). You need its local UUID: the `id` field of `GET /api/agents`.
- A vault key ring configured on the web **and** worker processes (below).
- A terminal on the server. With PGlite, the web process must be stopped while you run the CLI. With PostgreSQL you can run it online.
- Migrations applied. The CLI refuses to run with pending migrations.

## How credentials are stored

Each agent has at most one binding. It is encrypted (JWE, `dir` with `A256GCM`) with a key from your key ring and stored in the `agent_credentials` table. The ciphertext is bound to the organization
and agent, so copying a row to another agent does not decrypt. Credentials are never sent to the browser, never put in commands or task content, and are redacted from the protocol views the console shows.

### Set up the vault key ring

```bash
openssl rand -hex 32
```

Put the result in a JSON map, with any key ID you like (1 to 64 characters of letters, digits, `_` or `-`), and name the active one:

```bash
export A2A_VAULT_KEYS='{"key-2026-01":"<64 hex characters>"}'
export A2A_VAULT_ACTIVE_KEY='key-2026-01'
```

Every key must be exactly 64 hexadecimal characters. Share the same ring with the web and worker processes. Back it up separately from the database: a database backup without the keys cannot decrypt
any binding, and a key backup alone contains no credentials.

If you use `npx agent-taskbay` (after the first release) and set no `A2A_VAULT_KEYS`, the launcher generates a key ring once and keeps it in `secrets.json` in the data directory with mode 0600. It never
overwrites a file that exists. Deleting it makes stored credentials unreadable.

## Credential kinds

A binding is JSON with a list of `origins` the credential may be sent to, and one `credential`. Extra fields are rejected.

| `credential.type` | Fields | Notes |
|---|---|---|
| `apiKey` | `name`, `value` | Sent as header `name: value`. `name` may contain letters, digits and `-` only, and cannot be `Host`, `Cookie`, `Set-Cookie`, `Connection`, `Content-Length`, `Content-Type`, `Transfer-Encoding` or `Proxy-Authorization`. |
| `bearer` | `token` | Sent as `Authorization: Bearer <token>`. |
| `oauthClient` | `issuer`, `tokenEndpoint`, `clientId`, `clientSecret`, optional `scope` | OAuth client-credentials grant, client secret sent in the request body. The token endpoint's origin must also be in `A2A_ALLOWED_AGENT_ORIGINS`. The response must be a bearer token. |
| `mtls` | `cert`, `key`, optional `ca` (PEM text) | Client certificate for mutual TLS. Server certificate validation stays on. |

Limits: `origins` has 1 to 20 entries, each an HTTPS origin with no path, credentials, query or fragment (`https://agent.example.com`). Secrets are 8 to 100,000 characters. `scope` is at most 1000
characters. The CLI reads at most 256,000 bytes from standard input.

The credential is only attached to requests whose origin is in `origins`. Include the origin of the **Agent Card URL** as well as any interface URLs the card advertises, or discovery itself fails with
`Agent credential destination is not permitted.`

## Add or replace a binding

Send the JSON on standard input, not on the command line, so the secret stays out of process listings and shell history. Write it to a file readable only by you, then redirect it:

```json
{
  "origins": ["https://agent.example.com"],
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

For PGlite add `--offline-pglite` after stopping the web process. On success the only output is `Agent credential binding updated.` The script loads `.env` files, so database settings and the vault
variables may live there.

Check the result in **Settings**, section **Agent credentials**: it shows the credential kind, whether it is enabled, and when it was updated. It never shows secret values. Then open the agent in
the catalog and run a discovery; a working binding shows the agent's card instead of an error.

Storing again replaces the binding and enables it, which is how you rotate the credential itself. The previous value is not kept. Each store and revoke writes a `credential.rotated` or
`credential.revoked` row to the audit log.

## Revoke a binding

```bash
npm run security:credentials -- --organization acme --agent AGENT_UUID --action revoke
```

The binding is disabled, not deleted. From then on, calls for that agent fail with `Agent credentials are disabled.` rather than falling back to anonymous access. A call already in flight can finish.
Store a new binding to enable the agent again.

## Rotate the vault key

1. Add a new key to `A2A_VAULT_KEYS`, keeping the old one. Set `A2A_VAULT_ACTIVE_KEY` to the new ID. Restart web and workers so they all have the same ring.
2. For each agent with a binding, run:

   ```bash
   npm run security:credentials -- --organization acme --agent AGENT_UUID --action reencrypt
   ```

   This decrypts with the old key and stores again with the active key. It does not work on a revoked binding; store a replacement instead.
3. Remove the old key from the ring only after every binding has been re-encrypted. A binding whose key is missing cannot be read, and the agent fails with `Credential vault unavailable.`

There is no command that lists which key each binding uses. The `key_id` column of `agent_credentials` records it, if you have database access.

## When the CLI fails

The CLI prints one fixed message for every error, on purpose, so that no input is echoed:

```text
Credential update failed. Check the organization/agent, vault key configuration and stdin binding format. No secret values are printed.
```

The exit code is 1. Work through the causes in this order:

| Check | How |
|---|---|
| Pending migrations | `npm run db:migration:pending`, then `npm run db:migrate`. |
| Organization slug | `--organization` must be an existing slug (the one in `A2A_AUTH_ORGANIZATION_SLUG`, or `local` in development). |
| Agent | `--agent` must be a UUID of an enabled agent in that organization. |
| Vault keys | `A2A_VAULT_KEYS` is valid JSON, every value is 64 hex characters, and `A2A_VAULT_ACTIVE_KEY` names a key in it. |
| Binding JSON | Valid JSON that matches the table above: no extra fields, HTTPS origins with no path, secrets of at least 8 characters, under 256,000 bytes. |
| PGlite | `Stop the local web server and pass --offline-pglite before opening its PGlite directory.` |

## Network policy for outbound calls

These rules apply to every call from the web or worker process to an agent, to an OAuth token endpoint and to the notification webhook.

| Rule | Behaviour |
|---|---|
| Origin allowlist | `A2A_ALLOWED_AGENT_ORIGINS` is a comma-separated list of exact origins (`https://agent.example.com`, no path). In a production build it is required. A target outside it fails with `Agent target is not in the configured origin allowlist.` An entry with a path fails with `Agent allowlist entries must be exact origins.` |
| Which origins to list | The Agent Card origin, every HTTP interface origin the card advertises, each OAuth token endpoint origin, and the notification webhook origin if you use one. |
| HTTPS | Production builds require HTTPS: `Production agent targets require HTTPS.` |
| Private networks | Loopback, private and unique-local addresses are blocked in production unless `A2A_ALLOW_PRIVATE_NETWORKS=true`. Cloud metadata, link-local and other reserved addresses are always blocked, with `Agent network address is blocked.` DNS answers are checked on the actual socket, not only before connecting. |
| Redirects | Rejected: `Agent redirects are not permitted.` |
| Size | Responses and streams are capped at 25 MiB (`Agent response exceeds the safety limit.`), Agent Cards at 2 MiB. |
| Transports | JSON-RPC and HTTP+JSON. gRPC is refused: `gRPC transport is unavailable under the hardened network policy; advertise an HTTP binding.` |

The local launcher in its default mode (development identity on a production build) skips the allowlist requirement if none is set and allows private networks, so demo agents on `localhost` work. If you
set an allowlist there, it is enforced.

`NODE_ENV` decides what "production" means. `next start` sets it. The separate worker (`npm run worker:tasks`) runs under `tsx` and does not set it, so export `NODE_ENV=production` for the worker too, or it
will apply the development rules to its outbound calls (see [Running and workers](../operations/running-and-workers.md)).

## Agent Card trust pins

A card can carry signatures. Taskbay trusts a signature only if you pinned a public key for that exact origin:

```bash
export A2A_TRUSTED_CARD_KEYS='[{"origin":"https://agent.example.com","kid":"agent-key-1","expiresAt":"2027-01-01T00:00:00Z","jwk":{"kty":"OKP","crv":"Ed25519","alg":"EdDSA","x":"PUBLIC_KEY_BASE64URL"}}]'
```

| Field | Requirement |
|---|---|
| `origin` | Exact origin of the Agent Card URL. |
| `kid` | Must equal the `kid` in the signature header. |
| `jwk` | A public key (`RSA`, `EC` or `OKP`) with `alg` set to `RS256`, `ES256` or `EdDSA`, equal to the signature's `alg`. Private or symmetric keys are ignored. |
| `expiresAt` | An ISO timestamp in the future. An expired pin is treated as absent. |

Key URLs inside a card are never fetched.

| Card state | Result |
|---|---|
| Unsigned | Shown as "unsigned". Calls proceed, unless `A2A_REQUIRE_SIGNED_CARDS=true`. |
| Signed, signature verifies against a pin | `verified`. Calls proceed. |
| Signed, no matching pin | `untrusted`. Discovery shows the card, but calls fail with `Agent Card trust policy rejected this connection.` |
| Signed, matching pin but the signature fails | `invalid`. Same rejection. |

Trust never grants a person access; that is the job of grants.

## Skill grants

An administrator can grant a team or person access to one skill of an agent (see [Sign in and roles](./sign-in-and-roles.md#teams-and-grants)). Taskbay enforces it by choosing the `skillId` itself and
sending it to the agent under the extension `https://extensions.allsrc.dev/agent-taskbay/skill-routing/v1`. The agent must advertise and honour that extension. If it does not, a skill-only send is refused with
`This agent does not support bounded skill routing.` A grant does not constrain what a non-cooperating agent does internally, so turn this on only for agents you have reviewed. Details are in the
[skill routing reference](../reference/extensions/skill-routing.md).

## Other error messages

| Message | Meaning |
|---|---|
| `Agent credentials are required.` | The card declares security requirements and the agent has no binding. |
| `Agent OAuth credentials unavailable.` | The OAuth token request failed (endpoint not allowlisted, bad secret, not a bearer token). |
| `Credential vault unavailable.` | A wrong or missing key, a tampered row, or an invalid key ring. Fails closed. |
| `Agent network request failed.` | The generic wrapper for a failed outbound call. The cause is intentionally not exposed; check the allowlist, DNS and certificates first. |

## Limits

- One binding per agent. No per-user credentials: every person acts through the same agent credential. User-delegated OAuth is tracked in
  [#1](https://github.com/allsrc/agent-taskbay/issues/1).
- The key ring lives in environment variables. A KMS or external secret-manager adapter does not exist yet. See [Production deployment](./production-deployment.md#what-does-not-exist-yet) for what to do instead.
- No UI to create, rotate or revoke credentials, by design.
- gRPC agents cannot be used.
- Credentials for push notifications are separate: the push signing key (`A2A_PUSH_SIGNING_KEY`) derives per-registration tokens and is not a vault binding.

## Further reading

[Decision record: service credentials and scoped security](../archive/adr/0014-service-credentials-and-scoped-security.md).

## Related

- [How credentials are protected (security view)](../security/service-identity.md)
- [Connect an agent](./connect-an-agent.md)
- [Sign in and roles](./sign-in-and-roles.md)
- [Troubleshooting](../operations/troubleshooting.md)
