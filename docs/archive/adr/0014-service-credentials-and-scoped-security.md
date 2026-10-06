# ADR 0014: Service credentials and scoped security

- Status: Accepted
- Date: 2026-10-03
- Requirements: SEC-002..005, AGT-004, AUD-001

## Decision

Keep authorization and credential resolution behind application ports. Organization
administrators manage catalog and grants; other memberships need explicit read or
operate grants for an agent or skill. Enabled organization, membership and team
grants combine; operate includes read, while viewer roles never permit writes.
Task filters execute before pagination and content loading. Commands persist their
server-selected skill identity; task follow-ups cannot change it. Grants govern
new human requests; previously accepted commands remain system work after logout.

An advertised A2A skill is descriptive, not an invocation boundary. Skill-only
operations require the agent's reviewed `https://extensions.allsrc.dev/agent-taskbay/skill-routing/v1` extension.
The server sets SendMessage request metadata under this URI to `{ "skillId": ID }`
and includes the URI in negotiated request extensions. The agent must enforce that
route, reject unsupported skills and keep newly created contexts within it. A
restricted caller cannot supply an arbitrary existing context, reference an unseen
task, or override routing metadata. Agents without this contract require a whole
agent operate grant. Do not infer routing from prompts, tags or examples.

The initial CredentialVault adapter stores `jose` dir/A256GCM compact JWE in its
own database table. Authenticated payloads bind organization, agent and credential;
metadata exposes only kind, key ID, state and timestamp. A server-only key ring
supports decrypting old keys and re-encrypting under an active key. Provisioning
uses bounded standard input through an operator CLI; browser APIs never accept or
return credential plaintext. API key headers, bearer tokens, `openid-client` OAuth
client credentials and Undici mTLS are supported. Bindings specify exact HTTPS
destination origins in addition to the global outbound allowlist. Rotation is read
on each operation; revocation fails closed without anonymous fallback. A transport
already in progress may finish with its admitted credential.

The Phase 3 service identity baseline is verified before any user-delegated OAuth
extension, as ordered by PHASES.md. This adapter intentionally has no delegated
user-token consent/refresh lifecycle; that conditional follow-up requires separate
membership-bound bindings and durable worker subject selection. Plane A ID/access
tokens are never reused as Plane B credentials (ADR 0005). It is not represented as
implemented delegated authentication. The extension is pending for later review
in [GitHub issue #1](https://github.com/allsrc/agent-taskbay/issues/1).

Undici resolves and validates all DNS answers again inside the socket connector;
`ipaddr.js` classifies IPv4, IPv6 and mapped IPv4. HTTPS and exact global origins
are required in production; private/loopback addresses require explicit opt-in.
Link-local/metadata, unspecified, reserved and multicast targets remain denied.
All redirects are rejected. HTTP responses, including streaming bodies, have a
25 MiB aggregate limit. The SDK gRPC factory has no connection-bound resolver port,
so gRPC is rejected until a secure adapter exists; supported HTTP bindings remain
available. Never bypass the network policy to restore transport compatibility.

SDK Agent Card canonicalization and `jose` verify advertised JWS signatures using
operator-pinned asymmetric public keys, exact origin/kid, algorithm and expiry.
No advertised jku URL is fetched. Signed cards must have a verified signature to
execute; unsigned administrative registrations are allowed unless signed cards
are explicitly required. Trust is distinct from console grants. Use jose's verifier
after SDK canonicalization because the SDK verifier logs untrusted signature objects
on failures. This avoids process-global logger interception.

Artifact permissions are separate server-authored task/digest records created from
inline bytes archived by the server. Agent-supplied URLs or metadata cannot confer
access. Downloads require a currently visible referenced task and use attachment,
nosniff, no-store and sandbox CSP headers. Remote media/data/blob URLs are not loaded
by the renderer. Projection rebuilding restores permissions only from digest-verified
original archives, outside database locks, and commits them with activation.

Request rate buckets are durable across replicas/restarts. Login/callback/webhook
have fixed global budgets; authenticated reads, operations and administration have
membership budgets. Existing per-registration push authentication, scoped task
validation, duplicate handling and rate windows remain in force. Wire views contain
only fixed method/URL/status/duration facts. Known credentials are removed from
protocol strings, keys, inline binary parts, errors and sidebands before persistence.

## Consequences

- Existing non-admin memberships initially have no agent access; admins grant it
  explicitly. Existing tasks without a skill identity need whole-agent read access.
- Retained pre-upgrade binary archives need a projection rebuild to establish
  trusted access records. Missing/corrupt archives fail closed.
- Production operators protect the key ring, database, TLS termination and allowed
  agent infrastructure. Removing an old key before re-encryption makes its bindings
  unavailable. Database ciphertext is not a substitute for host secret protection.
- Global origin policy must include both agent interfaces and configured OAuth token
  endpoints; credential origins include only agent destinations.
- Signed-card key provisioning, credential setup and user provisioning remain operator
  workflows. Organization admin settings manage teams/grants and credential status.
- The service baseline does not claim gRPC, delegated OAuth, arbitrary remote artifact
  proxying or workflow-grade Phase 4 decisions/audit views.

## Evidence

Shared PGlite/PostgreSQL contracts cover grants, restricted task/artifact access,
forged references, vault tampering/rotation/revocation/restart and migrations.
Real TLS SDK agents exercise all four service profiles and signed-card failures.
Production HTTP fixtures exercise OIDC plus an encrypted protected-agent binding,
ungranted direct URLs/compatibility routes, secret disclosure and organization scope.
Network regressions cover actual socket DNS rebinding and chunked response limits.
