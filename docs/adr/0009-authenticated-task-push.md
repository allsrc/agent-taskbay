# ADR 0009: Authenticated task push and durable registration lifecycle

- Status: Accepted
- Date: 2026-10-03

## Decision

Push is opt-in through an operator-configured callback origin and a server-only
256-bit key. Each local task gets a durable registration UUID, used as the
remote config ID and callback path. Derive a single-purpose Bearer credential
with HMAC over that registration UUID and organization ID; no credential values
are stored in relational rows, protocol events, logs or browser responses.
Web and workers must share the key and callback origin. HTTPS is required except
for explicitly enabled loopback development. A missing or invalid key fails
closed. Key rotation invalidates old callbacks; roll out the new key to all
processes after deleting old remote configs and local registrations; startup
adopts tasks with new registration identities before resuming.
The production CredentialVault and managed rotation remain Phase 3 work.

Registration intent commits with task ingestion. Workers adopt existing
nonterminal tasks on startup. A leased registration state machine creates the
config with its stable ID (checking GetConfig before create retries), keeps it through input/auth-required, and deletes it
after a terminal state or agent disablement. A crashed create can repeat using
the same ID and credential. Remote configs must honor the supplied ID and be readable by that ID; delete
treats config-not-found as success. Unsupported peers stop with a
safe error. Transient lifecycle failures retry with bounded backoff, and late
worker completion is fenced. Lifecycle responses/telemetry are never persisted.
Both PGlite embedded and PostgreSQL external task workers run this lifecycle.

Callbacks accept the canonical A2A 1.0 StreamResponse union and explicit v0.3
Task snapshots. Authenticate before reading the bounded JSON body, apply a
durable per-registration rate limit, then validate the expected task and any
supplied tenant/context identity. Lock task then registration, recheck ownership
and authentication, and use the common ingestion transaction. Terminal tasks
acknowledge late authenticated callbacks without changing their projection;
deleted/disabled registrations reject them. An acknowledgement follows commit.

Webhook replay uses payload fingerprints scoped to the registration, without
per-request occurrence counters. Optional X-A2A-Delivery-ID distinguishes
identical append chunks and remains stable on retry. Without delivery identity,
identical append chunks within a turn are ambiguous and collapse; agents should
send complete artifact snapshots or stable delivery IDs. Stream/webhook
cross-source projection rebuilding and reconciliation remain later slices.

## Consequences

- Callback URLs and credentials come from server configuration, never browser
  input. Remote task IDs cannot redirect a callback to another tenant or agent.
- A persistent rate window survives replicas/restart. Perimeter/IP flood
  controls and production user/service authentication remain Phase 3 work.
- Config lifecycle uses dedicated durable leases, like task subscriptions,
  rather than changing the command outbox or resending user work.
- Configuration is server operated; no new user/admin registration API is
  introduced before the production authorization phase.

This extends ADRs 0002, 0005, 0007 and 0008.
