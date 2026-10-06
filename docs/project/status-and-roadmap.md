# Status and roadmap

> Who this is for: someone deciding whether Agent Taskbay is mature enough for their use. You will have what works today and how to verify it, what is partial, what is planned, and what is parked.

Agent Taskbay is **pre-1.0**. The package version is `0.1.0` and it is published to npm (see [CHANGELOG.md](../../CHANGELOG.md)). Interfaces, HTTP routes and stored data shapes may change between minor versions. There is no stable `/api/v1` yet. It has not been independently security-reviewed, and the only operating system the launcher package has been exercised on is Linux, from a local tarball.

## How to read "works"

"Works" here means an automated test in this repository exercises it. Each row names the npm script that runs that test. `npm run check` runs all of them (lint, unit, database, build and HTTP suites). Tests are not proof of production fitness: they use fixture agents written for this repository, not a range of real agents.

## Works today

| Capability | Proved by |
| --- | --- |
| Register agents from an Agent Card; A2A 1.0 over JSON-RPC and HTTP+JSON through the official SDK | `npm test`, `npm run test:http` (`verify-task-http.mjs`) |
| Send a task, stream it, cancel it, and see it again after the browser closes and the server restarts | `npm run test:db` and `npm run test:http` (`verify-task-http.mjs`) |
| Webhook (push) and polling reconciliation feeding the same idempotent ingestion path | `npm run test:db` (`push.db.test.ts`, `reconciliation.db.test.ts`) |
| Rebuilding task projections from retained events | `npm run test:db` (`projection-rebuild.db.test.ts`); CLI `npm run db:projections:rebuild` |
| OIDC sign-in, roles, teams, per-agent and per-skill grants | `npm run test:http` (`verify-identity-http.mjs`), `npm run test:db` (`identity.db.test.ts`, `scoped-security.db.test.ts`) |
| Encrypted agent credentials (API key, bearer, OAuth client credentials, mTLS), origin allowlist, SSRF controls, signed-card trust | `npm run test:http` (`verify-service-security.mjs`) |
| Approvals as decisions bound to an exact revision, with expiry | `npm run test:http` (`verify-decisions-http.mjs`), `npm run test:db` (`decisions.db.test.ts`) |
| Task ownership, assignment, due times, escalation and an append-only audit trail | `npm run test:http` (`verify-workflow-http.mjs`), `npm run test:db` (`workflow.db.test.ts`, `audit.db.test.ts`) |
| In-app notifications and a signed webhook channel | `npm run test:http` (`verify-notifications-http.mjs`), `npm run test:db` (`notifications.db.test.ts`) |
| Unified inbox across agents and teams | `npm run test:db` (`inbox.db.test.ts`) |
| Structured forms through an advertised extension | `npm run test:http` (`verify-forms-http.mjs`) |
| Agent-originated approval requests through an advertised extension | `npm run test:http` (`verify-agent-approvals-http.mjs`) |
| A2UI rendering from an allowlisted component set; unknown parts shown as inert data | `npm run test:http` (`verify-a2ui-http.mjs`, `verify-phase6-exit-http.mjs`), `npm test` |
| Optional AG-UI adapter (off by default) | `npm run test:http` (`verify-agui-http.mjs`) |
| `npx agent-taskbay` launcher package: install from a tarball, launch, register an agent, restart | `npm run verify:package` |

Databases: embedded PGlite for local use and PostgreSQL for real deployments. CI runs the database contract tests against PostgreSQL 18 (`.github/workflows/ci.yml`); local `npm run test:db` uses PGlite unless `A2A_TEST_POSTGRES_URL` is set.

## Partial

| Area | What exists | What is missing |
| --- | --- | --- |
| Operator workflow at scale | Inbox, approvals queue, ownership, due times, escalation | Saved views, full-text search, advanced filters, bulk triage, SLA indicators, agent health administration, notification preferences ([#5](https://github.com/allsrc/agent-taskbay/issues/5)) |
| Agent-originated approvals | Works for agents that advertise the approval extension | Blocking replies that bypass an open approval and an approval-required policy ([#16](https://github.com/allsrc/agent-taskbay/issues/16)), agent-side digest echo ([#17](https://github.com/allsrc/agent-taskbay/issues/17)), ADK adapter ([#18](https://github.com/allsrc/agent-taskbay/issues/18)), upstream extension proposals ([#19](https://github.com/allsrc/agent-taskbay/issues/19)); the broader item is [#15](https://github.com/allsrc/agent-taskbay/issues/15) |
| A2UI | A subset of components | More components ([#22](https://github.com/allsrc/agent-taskbay/issues/22)), functions and `openUrl` ([#23](https://github.com/allsrc/agent-taskbay/issues/23)), other surfaces ([#24](https://github.com/allsrc/agent-taskbay/issues/24)), verification against a real A2UI agent ([#25](https://github.com/allsrc/agent-taskbay/issues/25)) |
| AG-UI adapter | Basic runs, interrupts and resume | Thread-to-context mapping ([#8](https://github.com/allsrc/agent-taskbay/issues/8)), skill-scoped principals ([#9](https://github.com/allsrc/agent-taskbay/issues/9)), tools, context and state ([#10](https://github.com/allsrc/agent-taskbay/issues/10)), cross-origin browsers ([#11](https://github.com/allsrc/agent-taskbay/issues/11)), runs over 50 seconds ([#12](https://github.com/allsrc/agent-taskbay/issues/12)), real-client verification ([#13](https://github.com/allsrc/agent-taskbay/issues/13)), approval interrupts ([#20](https://github.com/allsrc/agent-taskbay/issues/20)) |
| Browser tests | HTTP-level suites and fixture agents | A committed browser end-to-end suite ([#14](https://github.com/allsrc/agent-taskbay/issues/14)); UI behavior was checked by hand, not in CI |
| Distribution | Package builds and launches from a tarball on Linux | First npm publish, and verification on macOS and Windows |
| Agent authentication | Service credentials | User-delegated OAuth ([#1](https://github.com/allsrc/agent-taskbay/issues/1)) |
| Identifier naming | Some persisted and wire identifiers use the older `a2a-ops` slug in places | Rename ([#27](https://github.com/allsrc/agent-taskbay/issues/27)) |

## Planned

Not started. Order and scope may change.

- Hosting artifacts: container images, compose or Helm files, a demo profile with PostgreSQL.
- Multi-replica web and worker deployment with shared leases.
- Object storage beyond the local filesystem (S3, Azure Blob), KMS or external-secret key management, retention and deletion controls.
- Backup, restore and upgrade-rollback runbooks that have been exercised, plus load and failure testing.
- Extension plugin contract and compatibility fixtures ([#26](https://github.com/allsrc/agent-taskbay/issues/26)).
- gRPC transport, which needs a connection-bound resolver adapter.

## Parked

- Taskbay client SDK and a stable `/api/v1` with service-token authentication ([#31](https://github.com/allsrc/agent-taskbay/issues/31)). Deliberately deferred.

## Not goals

Taskbay is not an agent builder, a generic workflow engine or a trace explorer. It does not see inside an agent's own delegation to other agents.

## Related

- [Compatibility and known limitations](../reference/compatibility.md)
- [Threat model](../security/threat-model.md)
- [Contributing](../contributing/development.md)
