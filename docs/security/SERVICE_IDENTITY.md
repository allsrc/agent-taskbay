# Agent service identity and access

Apply migrations before starting web/workers. Production needs explicit
`A2A_ALLOWED_AGENT_ORIGINS` (comma-separated exact HTTPS origins). Include every
allowed advertised HTTP interface and configured OAuth token endpoint. Private or
loopback infrastructure additionally needs `A2A_ALLOW_PRIVATE_NETWORKS=true`;
metadata/link-local/reserved destinations remain blocked. Redirects are rejected.
The hardened gateway currently supports JSON-RPC and HTTP+JSON, not gRPC.

Set server-only `A2A_VAULT_KEYS` to a JSON map of key IDs to 64 hexadecimal characters
(32 random bytes each), and `A2A_VAULT_ACTIVE_KEY` to the active ID. Never use
NEXT_PUBLIC variables. Share this ring between web and workers and retain a secure
backup separately from database/artifact backups. The vault uses jose authenticated
JWE and fails closed on wrong/missing keys, tampering or disabled bindings.

Register the agent as an administrator. Provision its binding through an operator
terminal with `npm run security:credentials -- --organization ORG_SLUG --agent
AGENT_UUID --action store`, sending JSON on **standard input**, not command arguments.
For PGlite, stop its owner first and add `--offline-pglite`; PostgreSQL supports online
administration. Avoid secret-bearing shell history and temporary world-readable files.
Only status is shown in Settings. There is no browser secret form.

Binding JSON has `origins` (exact HTTPS agent origins) and one `credential` object:

| Profile | Credential fields |
| --- | --- |
| `apiKey` | `type`, `name` (safe HTTP header), `value` |
| `bearer` | `type`, `token` |
| `oauthClient` | `type`, `issuer`, `tokenEndpoint`, `clientId`, `clientSecret`, optional `scope` |
| `mtls` | `type`, PEM `cert`, PEM `key`, optional PEM `ca` |

OAuth token destinations also need the global allowlist; they are not agent
credential destinations. Normal TLS validation remains enabled. Tokens from OAuth
client credentials are short-lived in process memory and are never persisted.
Plane A provider tokens cannot configure these bindings. User-delegated consent and
refresh are a conditional follow-up after this service baseline; they are not
implemented here.

Rotate credential material by storing a replacement. Rotate vault encryption keys
by adding a new key, selecting it as active, then running `--action reencrypt` for
each binding before removing the old key. `--action revoke` disables the binding;
a subsequent operation fails rather than switching to anonymous access. An already
admitted connection can finish. CLI errors never print supplied credential input.

Admins use Settings to create teams, assign members and grant/revoke access. Other
memberships have no default access to registered agents. Grants target a membership,
a team or the organization; choose read or read-and-operate for a whole agent or one
skill. Viewer roles cannot operate even when a grant says operate. Admins have full
organization access. Revocation applies to subsequent reads and commands; durable
work already accepted continues under system identity.

Skill-only sends need the agent to advertise and enforce
`urn:a2a-ops:skill-routing:1`. The server selects `skillId` and sends it under this URI
in request metadata with the extension URI. New restricted sends start a new context;
follow-ups preserve the task's skill. Generic invocation is denied. Grants do not
constrain a non-cooperating agent's internal behavior; only enable this extension
for reviewed infrastructure.

Advertised signed cards execute only when a signature verifies against
`A2A_TRUSTED_CARD_KEYS`, a JSON array of `{origin,kid,jwk,expiresAt}`. Each entry pins
an exact origin, key ID, public JWK with `alg` (RS256/ES256/EdDSA) and future ISO expiry.
Private/symmetric keys are rejected, and advertised remote key URLs are never fetched.
Unsigned cards display unsigned trust and can execute after administrative registration;
set `A2A_REQUIRE_SIGNED_CARDS=true` to require verified signatures for all agents.
Trust does not grant user access.

Pre-upgrade task artifacts require `npm run db:projections:rebuild -- --organization
ORG_UUID` (plus `--offline-pglite` with its owner stopped). Rebuilding verifies original
archive hashes and creates server-authored task/digest references; fabricated URLs
cannot authorize a download. Back up artifacts alongside the database. Downloads use
current task grants, attachment disposition and a sandbox policy. Remote artifact
media is not automatically fetched in the browser.

Request budgets per minute are 900 reads, 120 operations and 60 administrative calls
per membership, plus 240 global login/callback calls and 1200 global webhook calls.
Push registrations retain their separate 120-per-minute window. These durable limits
return 429; expired buckets reset on use. Gateway responses/streams are limited to
25 MiB total, and the artifact adapter limits each stored object to 16 MiB.

Run `npm run check` with `A2A_TEST_POSTGRES_URL` targeting a disposable test database.
The gate runs both database profiles, real TLS service-agent fixtures, OIDC production
HTTP and the existing durable task runtime. Fixture TLS certificates need `openssl`.
See [ADR 0014](../adr/0014-service-credentials-and-scoped-security.md) for boundaries
and [the threat model](THREAT_MODEL.md) for regression evidence.
