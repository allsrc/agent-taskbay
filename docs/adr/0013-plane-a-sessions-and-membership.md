# ADR 0013: Plane A library adapters and membership-bound sessions

- Status: Accepted
- Date: 2026-10-03

## Decision

Use `openid-client` for production OIDC authorization-code login, discovery,
PKCE S256, state/nonce and token claim/signature validation. Pin RS256 for the
initial provider profile and require HTTPS. Enable the library's JWKS signature
checks. Use `jose` JWE for encrypted, transient server-side login state. Do not
implement OIDC, JOSE or password authentication ourselves. Plane B remains a
separate gateway/vault adapter under ADR 0005.

Persist local users and exact `(issuer, subject)` external identities, with
organization memberships holding enabled state and the baseline admin/operator/
viewer role. An operator provisions memberships through a CLI. Provider email,
role, tenant and organization claims cannot provision or elevate users. No
production JIT account creation or browser-selected organization is permitted.

Issue a random opaque cookie after resolving an enabled membership. Store only
its SHA-256 hash, membership reference and absolute expiry. The cookie uses
`__Host-`, Secure, HttpOnly, SameSite=Lax and Path=/ without a Domain. Every
application HTTP entry point resolves the persisted session and current
user/membership state before executing. Single-use login attempts are consumed
under a transaction lock; nonce/PKCE material is encrypted with a separate
operator-managed key. Provider tokens are validated then discarded.

Route authentication establishes an async request-scoped principal shared by
runtime adapters. Queries, commands, registry, feeds, SSE and binary downloads
resolve organization from that principal. Compatibility routes receive the same
checks. Mutation Origin must exactly match the configured external origin;
Host/Forwarded headers never choose the OIDC redirect URI. Webhooks keep their
independent registration authentication under ADR 0009.

Development identity provisions one local administrator and ignores client
identity/scope selectors. It is the non-production default. A production-built
local/demo server needs both `A2A_AUTH_MODE=development` and
`A2A_ALLOW_DEVELOPMENT_AUTH=true`; an unconfigured production deployment fails
closed. This adapter must run only in trusted local/demo environments.

Append safe, fixed audit facts for login/logout, provisioning, agent registration/
removal and accepted commands. Command/catalog audit commits in the same database
transaction as intent. Stable command audit keys prevent retry duplication;
operator provisioning is identified as a system action rather than attributing
the provisioning action to its target user. Full workflow audit views remain
Phase 4.

## Consequences

- Sessions and login attempts work across PostgreSQL replicas and survive
  restart; PGlite retains its single-owner limitation. Logout revokes the
  server session and reloads the browser to discard the tab cache.
- No OIDC access/refresh/ID token enters application storage, protocol archives,
  browser state, audit or error responses. Session cookies are the sole browser
  credential. The encrypted flow key must be shared by web replicas; rotation
  invalidates pending login attempts. Existing sessions expire separately.
- Roles are a baseline organization policy. Scoped team/agent/skill grants,
  vault/service credentials, hardened outbound network policy, artifact-to-task
  access and signature trust remain unchecked Phase 3 deliverables. Membership
  alone currently grants organization-wide read access; operators can act on
  the organization's agents. This is not yet the production security exit gate.
- Checks occur at request admission. Already admitted bounded HTTP/SSE requests
  may finish after revocation; subsequent requests/reconnects fail. Worker
  commands already accepted durably remain system work and survive logout.
- Identity provisioning and membership changes are server-operated until scoped
  administrative APIs exist. CLI provisioning does not re-enable a disabled
  global user. PGlite CLI operations require web to be stopped explicitly.

This extends ADR 0005 and the Phase 2 runtime ADRs without replacing task identity,
worker ownership or command retry semantics.
