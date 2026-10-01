# ADR 0004: Modular monolith with separate workers

- Status: Accepted
- Date: 2026-10-01

## Context

The project is currently one Next.js application. Long-running agent tasks and
subscriptions should not be tied to browser connections or serverless request
duration. Splitting every capability into a microservice now would add network
and operational complexity before the domain is stable.

## Decision

- Keep one repository and one domain/application layer.
- Run a stateless Next.js web/API entry point.
- Run separate worker entry points for command dispatch, subscriptions,
  reconciliation, projections, and notifications.
- Coordinate web and workers through durable PostgreSQL-compatible state,
  leases, and the outbox.
- Introduce a shared message bus only behind an adapter when multiple-process
  scale makes it necessary.

## Consequences

- Local development runs at least web and worker processes, with a convenience
  command allowed to start both.
- HTTP route handlers stay thin and do not own task-lifetime streams.
- Module dependency rules must be enforced even though modules share a process
  and repository.
- A module can be extracted later without changing its domain ports.
