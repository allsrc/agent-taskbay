# Authentication and agent credentials

## User identity and sign-in

`npm run dev` defaults to a clearly labeled local development administrator.
Apply migrations with the PGlite web process stopped. A production-built trusted
local demo also requires `A2A_AUTH_MODE=development` and
`A2A_ALLOW_DEVELOPMENT_AUTH=true`. Production otherwise requires complete OIDC
configuration and fails closed. See `.env.example` for the server-only variables.

Configure an HTTPS OIDC issuer, client ID/secret, canonical external HTTPS origin,
organization slug and a separate 32-byte flow key (64 hex characters). Register
`https://YOUR_ORIGIN/api/auth/callback` at the provider. The initial profile uses
authorization code, S256 PKCE and RS256/JWKS validation through `openid-client`;
`jose` encrypts temporary server flow state. Cookies are Secure, HttpOnly,
host-only and SameSite=Lax. Terminate public HTTPS at a trusted proxy. Provider
tokens are discarded after validation; no Plane B credential is established by
signing in.

Provision the exact provider subject server-side before login:

```sh
npm run auth:provision -- --issuer https://YOUR_ISSUER --subject EXACT_SUBJECT \
  --organization YOUR_ORG_SLUG --name "Operator name" --role admin
```

For PGlite, stop web first and add `--offline-pglite`. PostgreSQL provisioning can
run online. Re-provisioning a membership updates its role/enabled state; it does
not re-enable a disabled global user. Membership and user `enabled` fields can
be managed by a trusted database operator pending scoped administrative APIs.
The only roles currently supported are `admin`, `operator`, and `viewer`.
Provider email, role and organization claims do not grant access. The configured
organization slug chooses the membership at login; browser selectors are ignored.

Admins manage the agent catalog, operators submit work, and viewers read their
explicitly granted organization data. Members require an agent/skill grant;
admins configure teams and grants in Settings. Service credentials are provisioned
through a server-only CLI and never returned to the browser. Authentication covers every application API, including
compatibility routes, command status, task content, SSE and binary downloads.
Webhooks use their independent registration authentication. Mutations require
an exact Origin matching `A2A_AUTH_ORIGIN` in OIDC mode. Sign out revokes the
session and reloads the page to discard the tab cache. Already admitted bounded
requests may finish; subsequent requests/reconnects recheck membership. Accepted
worker commands continue after logout.

`npm run check` includes signed-token regressions, shared PGlite/PostgreSQL session
contracts and production HTTP using a temporary TLS OIDC issuer (requires
`openssl`). See [ADR 0013](./docs/adr/0013-plane-a-sessions-and-membership.md) and
the [threat model](./docs/security/THREAT_MODEL.md).

## Agent credentials and network policy

The [service identity runbook](./docs/security/SERVICE_IDENTITY.md) covers encrypted
API key/bearer/OAuth client/mTLS bindings, rotation/revocation, team/skill grants,
production origin allowlists and Agent Card trust pins. The gateway validates actual
socket DNS answers, rejects redirects and limits response bytes. Secure HTTP bindings
are supported; gRPC is disabled until a connection-bound resolver adapter exists.
Before upgrading existing binary tasks, preserve their archives and rebuild projections
to establish trusted artifact permissions. See [ADR 0014](./docs/adr/0014-service-credentials-and-scoped-security.md).

