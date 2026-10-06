# ADR 0003: Local identity for remote A2A resources

- Status: Accepted
- Date: 2026-10-01

## Context

A2A task, context, message, and artifact IDs are issued by remote agents. The
same literal may be valid at two different agents or tenants. Cross-agent task
relationships also cannot assume that one agent understands another agent's
IDs.

## Decision

- Generate local UUID primary keys for every durable aggregate.
- Identify a remote Task by `(agentId, tenant, remoteTaskId)`.
- Apply equivalent scoping to remote contexts and messages.
- Use local `TaskLink` rows for cross-agent workflow relationships.
- Use A2A `referenceTaskIds` only within the receiving agent's meaningful scope.
- Pass selected content/artifacts or use an orchestrator agent for cross-agent
  handoff instead of forwarding an opaque foreign task ID.

## Consequences

- URLs and authorization checks use local IDs.
- APIs may expose remote IDs as diagnostic attributes, never as unscoped keys.
- Existing browser state keyed only by `taskId` is transitional and must not
  shape the persistent schema.
