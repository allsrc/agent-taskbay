# Status and roadmap

> Who this is for: someone deciding whether Agent Taskbay is mature enough for their use. You will have what works today and how to verify it, what is partial, what is planned, and what is parked.

Agent Taskbay is **pre-1.0**. The package version is `0.2.0` and it is published to npm (see [CHANGELOG.md](../../CHANGELOG.md)). Interfaces, HTTP routes and stored data shapes may change between minor versions. There is no stable `/api/v1` yet. It has not been independently security-reviewed, and the only operating system the launcher package has been exercised on is Linux.

This page describes the current checkout. Features listed under **Unreleased** in the [changelog](../../CHANGELOG.md#unreleased) require a source checkout until they are included in a published release.

## How to read "works"

"Works" here means an automated test in this repository exercises it. Each row names the npm script that runs that test. `npm run check` runs lint, unit and database tests, migrations, the schema check, the build and HTTP suites. Package-install verification is separate: `npm run verify:package`. Tests are not proof of production fitness: they use fixture agents written for this repository, not a range of real agents.

## Works today

| Capability | Proved by |
| --- | --- |
| Frontend-only content-view overrides and opt-in sanitized/styled HTML previews; no script execution or remote assets | `npm test` (`content-view.test.ts`, `html-preview.test.ts`, `content-viewer.test.tsx`); cross-browser verification remains open |
| Register agents from an Agent Card; A2A 1.0 over JSON-RPC and HTTP+JSON through the official SDK | `npm test`, `npm run test:http` (`verify-task-http.mjs`) |
| Find tasks another system started: browse an agent's tasks live (nothing stored), track one, answer, steer or cancel it; opt-in automatic discovery with limits; per-agent mode and deployment cap | `npm run test:db` (`discovery.db.test.ts`, `auto-discovery.db.test.ts`) and `npm run test:http` (`verify-discovery-http.mjs`) |
| Definite refusals by an agent are recorded as rejected with a kind; finished tasks are not continued; an unsupported required extension blocks sending until an administrator allows it | `npm run test:db` (`commands.db.test.ts`, `terminal-guard.db.test.ts`, `required-extensions.db.test.ts`) and `npm run test:http` (`verify-task-http.mjs`) |
| Send a task, stream it, cancel it, and see it again after the browser closes and the server restarts | `npm run test:db` and `npm run test:http` (`verify-task-http.mjs`) |
| Webhook (push) and polling reconciliation feeding the same idempotent ingestion path | `npm run test:db` (`push.db.test.ts`, `reconciliation.db.test.ts`) |
| Fetch and refresh an extended Agent Card as an administrator; display extra skills to whole-agent readers without changing routing or grants | `npm run test:db` (`extended-card.db.test.ts`) and `npm run test:http` (`verify-extended-card-http.mjs`) |
| Show the selected binding, interface, protocol version, tenant and extension negotiation; choose a tenant for a new conversation | `npm test` (`connection-interface.test.ts`, `connection-card.test.tsx`, `gateway-tenant.test.ts`) and `npm run test:http` (`verify-discovery-http.mjs`) |
| Task filters by context, agent, update time and origin; cursor paging and other tasks in the same context | `npm run test:db` (`task-list.db.test.ts`) and `npm run test:http` (`verify-task-http.mjs`) |
| Show whether extra input was delivered, followed by agent activity, refused or remains unknown; stop and restart with a new instruction as two separate commands | `npm test` (`steering-chip.test.tsx`, `restart-task.test.ts`, `restart-dialog.test.tsx`), `npm run test:db` (`steering.db.test.ts`) and `npm run test:http` (`verify-steering-http.mjs`) |
| Related tasks in both directions from message references, filtered by read grants; same agent and tenant only | `npm run test:db` (`task-links.db.test.ts`), `npm test` (`related-tasks.test.tsx`) and `npm run test:http` (`verify-steering-http.mjs`) |
| Select related tasks to cancel sequentially, with per-task permission checks and results, and a counts-only audit summary | `npm test` (`cancel-tasks-dialog.test.tsx`), `npm run test:db` (`task-links.db.test.ts`) and `npm run test:http` (`verify-steering-http.mjs`) |
| Load the agent's retained history on demand, label newly found messages and preserve that provenance across projection rebuilds | `npm run test:db` (`task-history.db.test.ts`) and `npm run test:http` (`verify-history-http.mjs`) |
| Remove Taskbay's leftover push configurations for finished tasks, leaving other callbacks alone | `npm test` (`push-lifecycle.test.ts`) and `npm run test:db` (`push-cleanup.db.test.ts`) |
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
| `npx agent-taskbay` launcher: install, launch, register an agent, restart | `npm run verify:package` |

Databases: embedded PGlite for local use and PostgreSQL for real deployments. CI runs the database contract tests against PostgreSQL 18 (`.github/workflows/ci.yml`); local `npm run test:db` uses PGlite unless `A2A_TEST_POSTGRES_URL` is set.

## Partial

| Area | What exists | What is missing |
| --- | --- | --- |
| Operator workflow at scale | Inbox, approvals queue, ownership, due times, escalation | Saved views, full-text search, advanced filters, bulk triage, SLA indicators, agent health administration, notification preferences ([#5](https://github.com/allsrc/agent-taskbay/issues/5)) |
| Agent-originated approvals | Works for agents that advertise the approval extension | Blocking replies that bypass an open approval and an approval-required policy ([#16](https://github.com/allsrc/agent-taskbay/issues/16)), agent-side digest echo ([#17](https://github.com/allsrc/agent-taskbay/issues/17)), ADK adapter ([#18](https://github.com/allsrc/agent-taskbay/issues/18)), upstream extension proposals ([#19](https://github.com/allsrc/agent-taskbay/issues/19)); the broader item is [#15](https://github.com/allsrc/agent-taskbay/issues/15) |
| A2UI | A subset of components | More components ([#22](https://github.com/allsrc/agent-taskbay/issues/22)), functions and `openUrl` ([#23](https://github.com/allsrc/agent-taskbay/issues/23)), other surfaces ([#24](https://github.com/allsrc/agent-taskbay/issues/24)), verification against a real A2UI agent ([#25](https://github.com/allsrc/agent-taskbay/issues/25)) |
| AG-UI adapter | Basic runs, interrupts and resume | Thread-to-context mapping ([#8](https://github.com/allsrc/agent-taskbay/issues/8)), skill-scoped principals ([#9](https://github.com/allsrc/agent-taskbay/issues/9)), tools, context and state ([#10](https://github.com/allsrc/agent-taskbay/issues/10)), cross-origin browsers ([#11](https://github.com/allsrc/agent-taskbay/issues/11)), runs over 50 seconds ([#12](https://github.com/allsrc/agent-taskbay/issues/12)), real-client verification ([#13](https://github.com/allsrc/agent-taskbay/issues/13)), approval interrupts ([#20](https://github.com/allsrc/agent-taskbay/issues/20)) |
| Browser tests | HTTP-level suites and fixture agents | A committed browser end-to-end suite ([#14](https://github.com/allsrc/agent-taskbay/issues/14)); UI behavior was checked by hand, not in CI |
| Distribution | Published to npm from GitHub Actions with trusted publishing and provenance; the package installs and launches on Linux | Verification on macOS and Windows |
| Agent authentication | Service credentials and visible `AUTH_REQUIRED` tasks; a person can authorize elsewhere and reply to resume | A guided authorization handoff and dedicated resume action; user-delegated OAuth ([#1](https://github.com/allsrc/agent-taskbay/issues/1)) |
| Identifier naming | Some persisted and wire identifiers use the older `a2a-ops` slug in places | Rename ([#27](https://github.com/allsrc/agent-taskbay/issues/27)) |

## Planned

Not started. Order and scope may change.

- Hosting artifacts: container images, compose or Helm files, a demo profile with PostgreSQL.
- Multi-replica web and worker deployment with shared leases.
- Object storage beyond the local filesystem (S3, Azure Blob), KMS or external-secret key management, retention and deletion controls.
- Backup, restore and upgrade-rollback runbooks that have been exercised, plus load and failure testing.
- Extension plugin contract and compatibility fixtures ([#26](https://github.com/allsrc/agent-taskbay/issues/26)).
- gRPC transport, which needs a connection-bound resolver adapter.
- **Authorization handoff for `AUTH_REQUIRED` tasks** ([#1](https://github.com/allsrc/agent-taskbay/issues/1)): today Taskbay shows the state and asks the person to authorize elsewhere, then reply to resume. There is no dedicated authorization link or completion action. The intended approach is to show an agent-supplied HTTPS authorization address as text with an explicit open action, send an explicit resume message on the same task, and recheck promptly after authorization. Taskbay would never receive or forward the user's credential through this handoff.
- **Signed incoming push notifications:** Taskbay currently verifies a per-registration bearer token. The bundled A2A SDK's default sender sends the configured authentication header or legacy token; it does not sign JWTs or provide JWKS. Signed-JWT verification is deferred until there is evidence that agents outside that SDK need it. This is separate from Taskbay's existing signed outgoing notification webhook.

## Parked

- Taskbay client SDK and a stable `/api/v1` with service-token authentication ([#31](https://github.com/allsrc/agent-taskbay/issues/31)). Deliberately deferred.

## Not goals

Taskbay is not an agent builder, a generic workflow engine or a trace explorer. It does not see inside an agent's own delegation to other agents.

## Related

- [Compatibility and known limitations](../reference/compatibility.md)
- [Threat model](../security/threat-model.md)
- [Contributing](../contributing/development.md)
