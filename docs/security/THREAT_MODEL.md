# Agent Taskbay threat model

Last reviewed: 2026-10-03 (combined Phase 3 service identity/security baseline).

## Assets and boundaries

Human sessions and organization data cross the browser/web boundary. OIDC is
server-only over TLS; exact issuer/subject maps to provisioned membership, not
provider role/email/tenant claims. Queued commands are admitted human intent that
becomes durable system work. Agent credentials, cards, remote tasks, webhooks and
artifacts cross the independent Plane B boundary. The server process/key ring,
operator CLI and configured origin/key pins are trusted deployment inputs.

| Threat | Control | Regression evidence / limits |
| --- | --- | --- |
| Anonymous access or accidental production demo identity | All application APIs resolve sessions; production fails closed; demo requires dual opt-in. | HTTP anonymous route inventory/config rejection. Development is trusted local only. |
| Forged token, login replay/CSRF | openid-client issuer/audience/signature/expiry/nonce/state/PKCE checks; one-use browser-bound encrypted flow. | Signed-token failures, concurrent consumption and TLS production login/callback/replay. |
| Session theft or revoked membership | Hashed opaque sessions; Secure/HttpOnly/Lax host cookies; current membership/user/role resolved per request. | Expiry/logout/restart/revocation/role-change contracts. Already admitted streams may finish; reconnect rechecks. |
| Scope spoofing or concurrent context bleed | AsyncLocalStorage principal; organization from local membership. | Concurrent scope tests; foreign task/command/content/artifact access denied. |
| Cross-site commands/administration | Exact configured Origin and Fetch Metadata checks; reads do not submit commands. | Wrong/missing Origin production HTTP; development same-port loopback alias checks. |
| Missing agent/skill grant or role escalation | Explicit organization/member/enabled-team grants, viewer role ceiling, SQL task filters before pagination, filtered skill cards. | Shared grants/disabled team/revoke tests; ungranted direct URL, compatibility and artifact HTTP checks; IdP admin claim cannot escalate viewer. Admin has full org access. |
| Skill grant used for unrestricted work | Explicit bounded-routing extension, immutable typed skill scope, server metadata, new restricted context, scoped follow-up/reference checks. | Generic/private/context/hidden-reference sends denied; metadata overrides cannot change selected skill. Only enable for agents reviewed to enforce the extension. |
| Vault theft, scope substitution, downgrade after revoke | jose authenticated JWE with organization/agent payload binding; exact origin bindings; key ring rotation; revoked/missing-key/tampered entries fail closed. | Both database profiles exercise ciphertext tampering, cross-org resolve, rotation/restart/revoke and safe audits. Host key protection is operational. |
| Credential leakage in telemetry, protocol echoes, errors or archives | Server-only provisioning/resolution; fixed wire facts; known credential redaction in strings, keys, binary bytes and sidebands; protected operation/stream errors generic. | Real TLS four-profile fixtures echo credentials; HTTP browser/log/storage/audit disclosure assertions; nested/binary redaction tests. Arbitrarily transformed or split secrets from hostile infrastructure are outside finite literal redaction; restrict trusted agent infrastructure and rotate compromised secrets. |
| SSRF, redirect leak or DNS rebinding | Exact production HTTPS origins; Undici socket resolver validates all answers; ipaddr mapped IP policy; no redirects/proxy inheritance; credentials additionally destination-bound. | Actual socket rebind test, mixed DNS/mapped metadata cases, TLS redirect/origin checks. Private infrastructure is explicit opt-in; gRPC disabled pending secure resolver adapter. |
| Malicious/oversized artifacts and remote browser fetches | Trusted server task/digest refs; current task grants; attachment/nosniff/no-store/sandbox; local digest URLs only, Markdown images suppressed. | Cross-org/grant artifact checks, forged URL/metadata denied, archive integrity/backfill, chunked 25 MiB transport limit and 16 MiB object limit. No remote media proxy or executable preview. |
| Forged card trust or malicious key URLs | SDK canonicalization plus jose JWS; exact origin/kid/algorithm/future expiry public key pins; no jku fetching. Signed invalid/untrusted cards cannot execute. | Valid/tampered/unknown-key/signature failures and real signed TLS agent. Unsigned administrative registration allowed unless signed-card policy enabled. Trust never grants access. |
| Webhook scope spoofing/replay/flood | Registration-specific auth, task/agent/tenant validation, duplicate-safe ingestion, per-registration and global durable budgets; secret echoes redacted. | Existing authenticated production push/reconciliation scenarios and shared push contracts. |
| Login/API flood and state growth | Fixed public budgets and per-membership read/operate/admin buckets; expiry resets; bounded body/timeouts; expired auth state cleaned on login. | Locking window/429/reset contract; authenticated route budgets. Perimeter limits still appropriate for deployment capacity. |
| Inconsistent audit or command retry | Fixed safe facts, audit and intent in one transaction, unique command event key. | Rollback/idempotency and production actor facts. Full workflow decisions/audit/retention views are Phase 4. |

## Completion limits

This baseline covers Plane A and four Plane B service profiles. User-delegated OAuth
consent/refresh remains the conditional follow-up after service verification; Plane A
tokens are never reused for agent auth. Accepted work can continue after human logout
or grant revocation; credential revocation applies when a new connection resolves.
External-key/KMS adapters, hardened gRPC, remote-media proxying and workflow-grade
approvals/audit are not claimed. Preserve original archives and run projection rebuild
for pre-upgrade artifact access. The existing local PGlite WAL corruption remains
separate from verified clean/upgrade database profiles; its preserved data was not reset.

Future security changes must update this model and their regression evidence.
