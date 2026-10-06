# Threat model

> Who this is for: operators and security reviewers deciding whether Agent Taskbay's controls fit their deployment. You will have the assets, trust boundaries, threats, the control for each, and the residual risk.

Agent Taskbay is a server that holds credentials for your agents and sends work to them on behalf of signed-in people. That makes it a high-value target. This page lists what it protects, who it trusts, and where the protection stops. It is pre-1.0 software and has not had an external security audit that we can point to. To report a problem, follow [SECURITY.md](../../SECURITY.md).

## Assets and trust boundaries

| Boundary | What crosses it | Trusted side |
| --- | --- | --- |
| Browser to web server (Plane A) | Human sessions, commands, organization data | The server. The browser is never a source of truth and never holds agent credentials. |
| Web server to identity provider | OIDC login (server-side, over TLS) | The configured issuer. Only the exact issuer and subject map to a provisioned membership; email, provider role and tenant claims are not used. |
| Server to agent (Plane B) | Agent Cards, tasks, webhooks, artifacts, credentials | Nothing by default. Agents are remote, third-party systems. |
| Deployment inputs | Vault key ring, push signing key, origin allowlist, trusted card keys, operator CLI | Trusted. Anyone who controls these controls the system. |

"Plane A" is how people authenticate to Taskbay; "Plane B" is how Taskbay authenticates to agents. They never share tokens. See [identity and access](../concepts/identity-and-access.md).

## Threats and controls

Each row names the control and where it is exercised. "Evidence" points at tests that exist in the repository.

| Threat | Control | Evidence and limits |
| --- | --- | --- |
| Anonymous access, or the demo identity reaching production | Every application API resolves a session. Production configuration fails closed. The development identity needs an explicit opt-in. | `npm run test:http` (`scripts/verify-identity-http.mjs`) checks anonymous routes and rejects bad configuration. The development identity is trusted for local use only. |
| Forged token, login replay, login CSRF | Server-side OIDC with issuer, audience, signature, expiry, nonce, state and PKCE checks. The login flow is encrypted, bound to the browser and single-use. | `verify-identity-http.mjs` runs a real TLS issuer with signed tokens, including replay. |
| Session theft or a revoked membership still working | Opaque session tokens stored hashed. Cookies are `__Host-` prefixed, `Secure`, `HttpOnly`, `SameSite=Lax`. Membership, user and role are read on every request. | `identity.db.test.ts` and the HTTP suite cover expiry, logout, restart, revocation and role change. A stream already open may finish; reconnecting rechecks. |
| Cross-tenant data bleed | The organization comes from the local membership, carried per request in async-local storage, not from request input. | `scoped-security.db.test.ts`: foreign tasks, commands, content and artifacts are denied. |
| Cross-site command submission | Exact `Origin` match and `Sec-Fetch-Site` rejection on state-changing requests. Reads do not submit commands. | Wrong or missing `Origin` is rejected in the production HTTP run. In development, loopback aliases on the same port are accepted. |
| Access without a grant; role escalation | Explicit grants to a member, team or the organization, for a whole agent or one skill. Viewers cannot operate even with an "operate" grant. Task queries are filtered in SQL before pagination. | Grant, disabled-team and revoke tests in `scoped-security.db.test.ts`. A provider "admin" claim cannot raise a viewer. Administrators have full organization access by design. |
| A skill grant used to do unrestricted work | Skill-only sends need the agent to advertise and enforce the [skill routing extension](../reference/extensions/skill-routing.md). The server picks the skill, starts a new context and checks follow-ups. | Generic, private-context and hidden-reference sends are denied in tests. A grant does not constrain an agent that ignores the extension. Enable it only for agents you have reviewed. |
| Credential theft from the database; substitution; use after revoke | Credentials are encrypted (JWE) with the organization and agent bound into the payload and are valid only for their configured origins. Key rotation is supported. Missing keys, tampering and revoked bindings fail closed. | `scoped-security.db.test.ts` on both database profiles: tampering, cross-organization resolve, rotation, revoke. Protecting the key ring on the host is an operator duty. |
| Credential leakage through logs, errors, echoes or archives | Credentials are provisioned and resolved server-side only. Known credential values are redacted in strings, object keys, binary bytes and sideband data. Errors from protected operations are generic. | Real TLS fixtures echo credentials back; `scripts/verify-service-security.mjs` asserts they do not reach the browser, logs, storage or audit. Redaction is by known literal: a hostile agent that transforms or splits a secret defeats it. Restrict who runs agent infrastructure and rotate anything suspected. |
| SSRF, redirects, DNS rebinding | Production requires exact HTTPS origins. The connecting socket resolves and validates every address it uses; mapped IPv4-in-IPv6 is handled. Redirects and ambient proxies are refused. Private networks are an explicit opt-in; metadata and link-local ranges stay blocked. | A real-socket rebinding test and TLS redirect and origin checks. gRPC is refused because the SDK does not expose a connection-bound resolver. |
| Oversized or malicious artifacts; remote content in the browser | Downloads use server-authored references and current task grants, `Content-Disposition: attachment`, `nosniff`, `no-store` and a sandbox policy. Markdown images are suppressed. Remote media is not fetched by the browser. | Forged URLs are denied; response bodies and streams are capped at 25 MiB and stored objects at 16 MiB (`src/lib/safe-fetch.ts`, `filesystem-artifact-store.ts`). There is no remote media proxy and no executable preview. |
| Forged Agent Card trust | Cards are verified with SDK canonicalization and JWS against pinned `{origin, kid, public JWK, alg, expiry}` entries. Remote key URLs are never fetched. A signed card that fails verification cannot execute. | Valid, tampered and unknown-key cases are tested. Unsigned cards can still be registered by an administrator unless `A2A_REQUIRE_SIGNED_CARDS=true`. Trust never grants user access. |
| Webhook spoofing, replay, flood | Per-registration authentication, task, agent and tenant validation, duplicate-safe ingestion, and durable per-registration and global budgets. | Push and reconciliation scenarios in `push.db.test.ts` and `verify-task-http.mjs`. |
| Login and API floods | Durable fixed-window budgets per minute: 900 reads, 120 operations and 60 administrative calls per membership; 240 login/callback and 1200 webhook calls globally. Over budget returns 429. | Limits are in `src/server/runtime/identity.ts` and `security.ts`. Put a perimeter limiter in front for real capacity planning. |
| Inconsistent audit, double execution on retry | Audit facts and the command's intent are written in one transaction, with a unique command key. | Rollback and idempotency tests in `audit.db.test.ts` and `commands.db.test.ts`. |

## Residual risk and what is not claimed

- **Accepted work outlives access changes.** Work already admitted continues under a system identity after a person logs out or a grant is revoked. Credential revocation takes effect when the next connection resolves the credential.
- **User-delegated OAuth is not implemented** ([#1](https://github.com/allsrc/agent-taskbay/issues/1)). Agent authentication uses service credentials (API key, bearer, OAuth client credentials, mTLS). Plane A tokens are never reused toward agents.
- **No external key management.** The vault key ring is read from environment variables. KMS and external-secret adapters are planned, not built.
- **No gRPC**, no remote-media proxy and no executable preview.
- **Skill grants are a Taskbay-side control.** They do not limit what a non-cooperating agent does internally.
- **Local mode is not a boundary.** The launcher signs everyone in as a development administrator and binds to loopback.
- **Audit retention.** The audit trail is append-only; there is no built-in retention, export or tamper-evidence feature.
- **Not independently audited.** Treat the controls above as design intent backed by the listed tests.

Changes to authentication, credentials, outbound requests, webhooks or artifact handling should update this page and add a regression test.

## Related

- [How credentials are protected](service-identity.md)
- [Identity and access](../concepts/identity-and-access.md)
- [Status and roadmap](../project/status-and-roadmap.md)
- [SECURITY.md](../../SECURITY.md)
