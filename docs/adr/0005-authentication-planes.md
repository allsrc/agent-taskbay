# ADR 0005: Separate user, agent, and in-task authorization

- Status: Accepted
- Date: 2026-10-01

## Context

The console participates in three different security interactions that are
easy to conflate:

1. A human authenticates to the console.
2. The console authenticates to an A2A agent.
3. A running task asks for additional authorization or human approval.

Treating one as another can expose credentials or turn a task-state transition
into unintended authorization.

## Decision

- Plane A is application login: local development identity or production OIDC.
- Plane B is per-agent service or user-delegated authentication resolved only
  on the server.
- `TASK_STATE_AUTH_REQUIRED` is an in-task protocol state with explicitly
  defined resolution; it is not proof of user identity or approval.
- Business approval is a typed, scoped, expiring Decision aggregate correlated
  to a proposed action and observed execution.
- Authorization policy is enforced by the console independently of what an
  Agent Card advertises.

## Consequences

- Auth features can be independently optional in local development but cannot
  share credential storage or semantics.
- Credentials are delivered out of band unless a reviewed extension explicitly
  defines secure in-band exchange.
- The UI uses distinct language and controls for login, connect/authenticate,
  input required, authorization required, and approve/reject.
