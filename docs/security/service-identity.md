# How agent credentials are protected

> Who this is for: a security reviewer or operator who wants to know how Taskbay stores and uses the credentials it holds for your agents. You will have the storage model, the network rules, and what is not covered. For the setup steps, use [agent credentials](../guides/agent-credentials.md).

Taskbay calls agents on behalf of people. To do that it holds credentials for each agent. Those credentials are never sent to the browser and are never shown after you store them.

## Storage

- Credentials live in the database as authenticated JWE ciphertext (`jose`). The organization and agent ids are bound into the payload, so a ciphertext copied to another agent or organization does not decrypt into a usable binding.
- The key ring is `A2A_VAULT_KEYS` (a JSON map of key ids to 32 random bytes as 64 hex characters) plus `A2A_VAULT_ACTIVE_KEY`. Both are server-only; never use a `NEXT_PUBLIC_` variable. Web and worker processes must share the ring. Back it up separately from the database.
- A wrong or missing key, a tampered ciphertext or a revoked binding fails closed. Taskbay does not fall back to unauthenticated calls.
- Supported credential kinds: `apiKey`, `bearer`, `oauthClient` (client credentials; tokens are short-lived and kept only in process memory) and `mtls`. Each binding also lists the exact HTTPS origins it may be sent to.
- Provisioning is by an operator CLI that reads JSON from standard input (`npm run security:credentials`). There is no browser form for secrets; Settings shows status only. CLI errors do not print the supplied input.

## Where credentials may go

- Production requires `A2A_ALLOWED_AGENT_ORIGINS`, a comma-separated list of exact HTTPS origins. It must include every advertised agent interface and any OAuth token endpoint in use.
- The connecting socket validates the address it actually connects to, so a hostname that resolves to a private address at connection time is rejected. Redirects are refused; proxy environment variables are not inherited.
- Private and loopback destinations need `A2A_ALLOW_PRIVATE_NETWORKS=true`. Metadata, link-local and reserved ranges stay blocked.
- Supported transports are JSON-RPC and HTTP+JSON. gRPC advertised interfaces are filtered out because the SDK cannot bind its connection to this check.
- Responses and streams from agents are capped at 25 MiB.

## Rotation and revocation

- Rotate a credential by storing a replacement.
- Rotate vault keys by adding a key, making it active, then running the CLI `reencrypt` action for each binding before removing the old key.
- `revoke` disables a binding. Later operations fail; a connection already open can finish.

## Agent Card trust

With `A2A_TRUSTED_CARD_KEYS` (JSON array of `{origin, kid, jwk, expiresAt}`), a card whose signature verifies against a pinned key shows as verified. A card that is signed but fails, or uses an unpinned key, cannot execute. Unsigned cards still work after administrator registration unless `A2A_REQUIRE_SIGNED_CARDS=true`. Keys must be public, with `alg` of RS256, ES256 or EdDSA and a future expiry. Remote key URLs are not fetched. Trust is about the agent's identity, not about who may use it.

## Access to agents

Access is a separate layer: explicit grants to a member, team or organization, scoped to an agent or one skill, with a role ceiling. See [identity and access](../concepts/identity-and-access.md).

## Limits

- Host protection of the key ring and the database is your responsibility. There is no KMS integration yet.
- Redaction removes known credential values, not transformed copies.
- User-delegated OAuth is not implemented ([#1](https://github.com/allsrc/agent-taskbay/issues/1)).
- Nothing here has been independently audited.

## Further reading

- [Decision record: service credentials and scoped security](../archive/adr/0014-service-credentials-and-scoped-security.md)

## Related

- [Agent credentials guide](../guides/agent-credentials.md)
- [Threat model](threat-model.md)
- [Configuration reference](../reference/configuration.md)
