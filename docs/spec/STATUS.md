# Execution status

Last updated: 2026-10-05

## Active position

- Last completed phase: **Phase 4 — approval-grade human intervention**
- Active phase: **Phase 5 — operator experience** (not started)
- Last completed slice: **4.5 — durable notifications and one external channel** (completing Phase 4)
- Next executable slice: **5.1 — unified authorized inbox over tasks and approvals**
- Blocking decisions: none

## Pending follow-ups

- **User-delegated OAuth — pending:** consent, membership-bound encrypted tokens,
  refresh/revocation and durable worker subject selection are tracked in
  [GitHub issue #1](https://github.com/shashikanth-gs/a2a-ops/issues/1).
  Deferred by agreement on 2026-10-03 for later review. This is separate from the
  verified Phase 3 service identity baseline and does not block Slice 4.1.

## Accepted implementation choices

- Product name: A2A Ops.
- Formal name: A2A Operations Console.
- Repository slug: `a2a-ops`.
- Tagline: "The human operations console for A2A agent workflows."
- ORM: MikroORM using Data Mapper/Unit of Work/Entity Repository patterns.
- Local default database: file-backed PGlite.
- Production database: PostgreSQL.
- Optional database: SQLite/libSQL adapter after the canonical repositories
  work; it is not allowed to redefine schema semantics.
- Runtime: modular monolith with separate web and worker entry points.
- Reliability: immutable protocol-event ledger, rebuildable projections, and a
  transactional outbox.
- Identity: local UUIDs; remote A2A IDs scoped by agent and tenant.

## Verified baseline evidence

Verified on 2026-10-01 before Phase 1:

- `npm run lint`: passed.
- `npm test`: 7 files and 27 tests passed.
- `npm run build`: passed with all current routes generated.
- `npm audit`: zero reported vulnerabilities.
- Existing user-owned untracked files were left untouched.

The coverage run reported 72.7% statements and 79.35% lines for modules loaded
by the current unit suite. This is not whole-application coverage; API routes,
the gateway, UI flows, and live-agent behavior need explicit tests.

## Phase 1 verified slice evidence

Date: 2026-10-01

Slice: **1.1 — database bootstrap**

Changes:

- Added exact-version MikroORM 7.2.3 core, migrations, PGlite, PostgreSQL, and
  CLI packages. The official drivers resolve PGlite 0.5.8 and `pg` 8.23.0.
- Raised the Node.js floor to 22.17.0, the minimum supported by MikroORM 7.2.3,
  and aligned CI and Node type declarations.
- Added validated `pglite` and `postgresql` configuration. PGlite defaults to
  the file-backed `.data/pglite` directory; PostgreSQL requires a server-only
  URL.
- Added a reload-safe ORM initialization promise plus isolated request and job
  EntityManager helpers. Node-only database packages are externalized from
  Next.js server bundles.
- Added a schema-neutral baseline migration, migration/schema commands, and an
  adapter contract suite shared by PGlite and PostgreSQL.
- Added a PostgreSQL 18 CI service and included database and schema checks in
  the full quality gate.

Verification commands and results:

- `A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test npm run check`:
  passed lint; 8 unit files and 31 tests; 1 database file and 3 tests against
  PGlite and PostgreSQL; migration schema check; and the Next.js 16.3.6
  production build with all 18 routes reported successfully.
- `npm run db:migrate`, `npm run db:migration:list`, and
  `npm run db:schema:check`: the baseline applied, was listed as executed, and
  reported no schema drift.
- `npm audit`: zero reported vulnerabilities.
- `npm ls @mikro-orm/core @mikro-orm/pglite @mikro-orm/postgresql @mikro-orm/migrations @mikro-orm/cli @electric-sql/pglite pg --depth=1`:
  all MikroORM packages resolved to 7.2.3, PGlite to 0.5.8, and `pg` to 8.23.0.

Migration tested from:

- A clean temporary file-backed PGlite directory, followed by close/reopen to
  verify persisted migration state.
- A clean PostgreSQL 18 Alpine database, including rollback and reapplication
  so the contract is repeatable.

Remaining risks:

- Slice 1.1 intentionally has no domain tables. The baseline migration is
  schema-neutral so Slice 1.2 remains the sole owner of the initial entities.
- Node 26 emits a non-failing `module.register()` deprecation warning from the
  MikroORM CLI TypeScript config loader; the supported CI floor is Node 22.17.

Next executable slice at verification time: **1.2 — initial model and ports**.
Implement the six initial persistence entities, narrow application repository
ports, the default local organization bootstrap, and scoped remote-task
identity. Do not begin Slice 1.3.

## Phase 1 Slice 1.2 verified evidence

Date: 2026-10-01

Slice: **1.2 — initial model and ports**

Changes:

- Added plain domain records and ORM-independent repository ports for
  organizations, agents and Agent Card snapshots, tasks, task events, and the
  transactional outbox.
- Added MikroORM mappings and a PostgreSQL-compatible migration for all six
  initial entities, including foreign keys, organization-scoped read indexes,
  event deduplication, outbox readiness indexes, and optimistic task versions.
- Added MikroORM repository adapters that preserve organization scope at read
  boundaries and use one common contract on PGlite and PostgreSQL.
- Added an idempotent `local` organization bootstrap. Runtime ORM initialization
  invokes it after migrations have been applied; tests can invoke the lower
  database initialization boundary without requiring an existing schema.
- Enforced remote task identity with a database unique constraint on
  `(agentId, tenant, remoteTaskId)`. PostgreSQL null semantics intentionally
  allow multiple direct-message records whose `remoteTaskId` is null.

Verification commands and results:

- `A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test npm run check`:
  passed lint; 8 unit files and 31 tests; 2 database files and 6 tests against
  PGlite and PostgreSQL; migration schema check; and the Next.js 16.3.6
  production build with all 18 routes reported successfully.
- `npm run db:migrate`, `npm run db:migration:list`, and
  `npm run db:schema:check`: both the baseline and initial-model migrations are
  applied and listed, with no schema drift.
- `npx tsc --noEmit`: passed.
- `npm audit`: zero reported vulnerabilities.
- `git diff --check`: passed.

Migration tested from:

- A clean temporary file-backed PGlite database through both migrations,
  followed by close/reopen verification.
- The immediately previous baseline-only PGlite schema, upgraded through the
  initial-model migration with no schema drift.
- A clean PostgreSQL 18 Alpine database through the same migration and
  repository contract used by PGlite.

Repository behavior verified:

- Default-organization bootstrapping is repeatable and retains the original
  locally generated UUID and timestamps.
- Agent Card URLs are unique per organization but may repeat across
  organizations; snapshot history returns the latest discovery.
- A remote task ID may repeat across agents or tenants, but the same
  `(agentId, tenant, remoteTaskId)` is rejected by the database.
- Multiple direct-message records with null remote task IDs are accepted.
- Duplicate task-event source keys are ignored, and task-event/outbox reads are
  organization scoped.

Remaining risks:

- The UI still uses the JSON-file registry until Slice 1.3 replaces that
  adapter and migrates existing managed entries.
- Slice 1.2 defines event source-key uniqueness; the canonical digest fallback
  and full ingestion transaction remain Phase 2 work.
- Domain persistence exists, but task list/detail APIs and UI reads remain
  Slice 1.4.

Next executable slice: **1.3 — durable registry**. Replace the JSON-file
managed-agent adapter, preserve environment-seeded non-removable entries,
persist discovery/compliance snapshots, and migrate existing managed entries
idempotently. Do not begin Slice 1.4.

## Phase 1 Slice 1.3 verified evidence

Date: 2026-10-03

Slice: **1.3 — durable registry**

Changes:

- Replaced the JSON-file registry writer with a MikroORM database adapter,
  backed by the existing organization-scoped Agent repository port and a
  framework-independent AgentCatalogService.
- New catalog identities are local UUIDs. Legacy URL-hash IDs remain accepted
  for reads and removal so existing agent links and browser conversations can
  resolve their registered agent.
- Environment-seeded agents are deduplicated, persisted, and non-removable.
  A managed entry overlapping a seed remains protected while configured;
  environment-only entries leave the active catalog when unconfigured while
  keeping their persisted identity and history.
- Catalog and registered-agent detail discovery now atomically append raw and
  normalized Agent Card snapshots, compliance reports, digest, unverified
  signature status, and discovery/healthy timestamps. Wire telemetry is not
  included in the snapshot.
- Legacy agents.json entries are imported transactionally on first registry
  access. The original file is retained unchanged, malformed imports fail
  without partial writes, and failed imports can retry after repair.
- Managed removal disables the record, preserving task references, snapshots,
  and identity. Repeat imports cannot restore removed agents; explicit
  registration re-enables the original UUID.
- Added concurrent registration, restart/recovery, import, rollback, seed
  protection, discovery, and organization-isolation coverage and documented
  the registry migration and configuration.

Verification commands and results:

- Before implementation, the existing full quality gate passed against
  PGlite and PostgreSQL 18: 31 unit tests, 6 database tests, lint, schema check,
  and production build.
- `A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test npm run check`:
  passed lint; 9 unit files and 29 tests; 3 database files and 10 tests across
  PGlite and PostgreSQL; schema check; and the Next.js production build.
- `npm run build`: passed again after excluding runtime import data from
  Turbopack filesystem tracing, with no build warnings.
- `npx tsc --noEmit`: passed.
- `npm audit`: zero reported vulnerabilities.
- `git diff --check`: passed.
- Production HTTP smoke with `next start -p 3103`, a fresh file-backed PGlite
  database, and a local fixture Agent Card server passed: legacy import,
  catalog/detail discovery, old-ID resolution, environment deletion returning
  409, managed registration/removal, and recovery after a complete server
  restart. The removed legacy entry stayed absent and the original JSON file
  stayed unchanged.

Migration tested from:

- Clean PGlite and PostgreSQL 18 databases using the existing migrations.
- The previous baseline-only PGlite schema upgraded to the initial-model
  schema, using the existing shared migration contract.
- Existing agents.json data with duplicates and overlapping environment seeds,
  imported repeatedly across independent registry instances and ORM restart.
- No schema change was required for this slice; the Slice 1.2 schema remains
  current with no drift.

Remaining risks:

- Task views still use browser state until Slice 1.4; Phase 1 is not complete.
- Signature status is explicitly unverified; cryptographic trust and access
  policy remain Phase 3 work.
- Snapshot persistence covers registered-agent catalog/detail discovery.
  Unregistered previews and transport-internal discovery are not snapshot
  writers in this slice.
- Runtime database migrations remain an explicit setup/deployment step.

Next executable slice: **1.4 — first durable task read path**. Persist observed
stream task snapshots/events, add organization-scoped task list/detail query
services and APIs, switch Tasks views to server reads, and add restart/recovery
and remote-ID collision tests. Do not begin Phase 2.

## Phase 1 Slice 1.4 verified evidence

Date: 2026-10-03

Slice: **1.4 — first durable task read path**

Changes:

- Added organization-scoped task observation and query services behind the
  persistence ports. Streams, blocking replies, and cancellation responses
  persist their event ledger and current projection in one locked transaction
  before acknowledging persistence to the browser.
- Added the task-content migration, initial history/status/artifact projection,
  scoped local UUIDs, direct-message identities without fake remote tasks,
  stable user message IDs, and duplicate/stale-event handling. Accepted
  ADR 0006 documents the transitional projection and fingerprint limits.
- Tasks list/detail now use paginated server APIs, indexed state filters,
  five-second/focus refresh, retry controls, local UUID links, and scoped task
  references. Chat conversation keys include agent and tenant to avoid remote
  context collisions.
- Added a filesystem ArtifactStore with organization-scoped, content-addressed
  binary objects and original-event archives. Ledger rows retain safe object
  references rather than inline bytes. Downloads are attachment-only.
- Added shared adapter contracts and a production HTTP fixture/restart test
  to the quality gate, with no external database required for that HTTP test.

Verification commands and results:

- Before implementation, the previous quality gate passed: 29 unit tests,
  10 database tests across PGlite and PostgreSQL, lint, schema, and build.
- `A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test npm run check`:
  passed lint; 11 unit files and 35 tests; 4 database files and 12 tests on
  PGlite and PostgreSQL 18; schema check; production build; and production
  HTTP verification.
- Adapter tests verify concurrent registration, scoped remote-ID collisions,
  atomic rollback, duplicate/repeated artifact chunks, stale status handling,
  user turns, direct messages, binary archives, cross-organization isolation,
  pagination, scoped references, and database close/reopen recovery.
  User attachments retain reachable original-event archives as well as safe
  projection references.
- Production HTTP verification covers streaming, resubscription, cancellation,
  blocking direct replies, binary downloads, invalid requests, agent/tenant
  collisions, and two independent readers after a complete web-server restart.
- Browser verification with two fresh tabs showed the same durable task,
  user history, input prompt, timeline, and binary download. Keyboard selection
  of Done showed only the canceled task; the browser console had no errors.
- `npm run db:migrate`: applied the task-content migration to the local
  database. Schema check reported no drift.
- `npm audit`: zero reported vulnerabilities.

Migration tested from:

- Clean file-backed PGlite and PostgreSQL 18 databases through all three
  migrations, with the same adapter contract.
- The immediately previous initial-model PGlite schema containing an existing
  task row. Upgrade preserves its remote ID and state and initializes empty
  content without schema drift.
- Complete ORM and production web-server restart with persisted task content
  and filesystem artifacts recovered successfully.

Remaining risks:

- Streams remain tied to connected browser requests until the Phase 2 worker
  runtime. Chat, orchestration, and notification caches remain browser-local;
  old browser history is not automatically imported into durable storage.
- Events lacking stable remote IDs/timestamps use canonical fingerprints,
  occurrence counts, and persisted user turns. Arbitrary partial artifact
  replays remain ambiguous; reconciliation and versioned replay are Phase 2.
- Immutable files can remain orphaned after a failed database transaction.
  Retention and garbage collection remain future ArtifactStore work; back up
  the artifact directory alongside the database.
- Routes use the development local organization. Authentication and production
  authorization/content policy remain Phase 3; runtime migrations remain an
  explicit setup/deployment step.

**Phase 1 exit criteria are verified.** The registry and observed tasks survive
restart; clean readers share task state; PGlite needs no external database;
both adapters pass the same contract; clean and previous-schema migrations
pass. Phase 2 is now active, with no Phase 2 implementation started.

Next executable slice: **2.1 — durable command dispatch**. Persist command
intent with stable message/idempotency IDs and its outbox record atomically,
then implement durable dispatch/retry state. Verify duplicates, organization
scope, and restart recovery before moving long-lived streams into workers.

## Phase 2 Slice 2.1 verified evidence

Date: 2026-10-03

Slice: **2.1 — durable command dispatch**

Changes:

- Added TaskCommand, its migration, organization-scoped command repository,
  intent service, gateway port/adapter, and command dispatcher. Intent and the
  command-ID-only outbox row commit atomically. Command input, including inline
  binary parts, is archived in ArtifactStore rather than relational rows.
- Idempotency keys return the original command for identical intent and reject
  changed intent with 409. Message IDs persist across dispatch attempts.
  Compatibility keys include agent and tenant scope.
- Added leased, concurrently claimable outbox dispatch, heartbeat renewal,
  fenced completion, and bounded pre-dispatch retry. Response ingestion,
  projection updates, command success, and outbox completion share a transaction.
  Uncertain remote failures and expired attempts never automatically resend.
- Added a 202 command submission API and scoped status/result API. Existing
  send, streaming-send, and cancellation entry points now commit intent before
  remote dispatch. Streaming sends receive a worker-dispatched SendMessage
  snapshot, then keep browser-owned follow-up subscriptions until Slice 2.2.
- Added embedded local dispatch at Node server startup and a separate
  PostgreSQL command worker. ADR 0007 adjusts the local process topology because
  independent web/worker processes cannot own the same PGlite directory.
- Stabilized ORM entity names across separately minified Next.js startup and
  route chunks; production HTTP tests verify both paths use the same mappings.

Verification commands and results:

- Before implementation, the Phase 1 quality gate passed against PGlite and
  PostgreSQL 18: 35 unit tests, 12 database tests, lint, schema, build, and HTTP
  restart verification. The initial PostgreSQL attempt failed because its
  disposable container was absent; recreating it restored the baseline.
- `A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test npm run check`:
  passed lint; 11 unit files and 36 tests; 5 database files and 14 tests on
  PGlite/PostgreSQL 18; schema check; production build; and HTTP verification
  on PGlite with embedded dispatch and PostgreSQL with a separate worker.
- Shared command contract verifies concurrent duplicate acceptance, conflict
  detection, command/outbox rollback, two-worker claim races, restart recovery,
  stable IDs, bounded retries, expired leases, fenced response rollback,
  redacted errors, binary input archives, and cross-organization dispatch/read
  isolation, including direct Message replies.
- Production HTTP checks verify all command entry points, command status,
  duplicate dispatch count, input errors, scoped tasks/artifacts, full web
  restart, and a browser stream closed immediately after acceptance while the
  command still completes. The PostgreSQL test creates and removes its own
  temporary test database and exercises the actual worker entry point.
- Browser chat verification passed through the existing composer: command
  acceptance appeared in Wire, the direct Message reply rendered, and the
  browser console reported no errors.
- `npm run db:migrate`: applied the command migration locally. The first gate
  correctly detected the pending local schema; rerunning after migration passed.
- `npm audit`: zero reported vulnerabilities.

Migration tested from:

- Clean PGlite and PostgreSQL 18 databases through all four migrations.
- The immediately previous task-content PGlite schema with an existing task,
  upgraded to the command schema without losing its remote identity or state.
- Command and task recovery after database-owner and production web restart.

Remaining risks:

- Phase 2 is still in progress. Long-lived task subscriptions remain owned by
  browser requests; worker reconnect, reconciliation, webhooks, versioned replay,
  live freshness signals, and browser-cache removal are subsequent slices.
- Unknown remote outcomes are recorded as uncertain; no exactly-once remote
  execution guarantee is claimed. Reconciliation/recovery controls are pending.
- Initial sends use SendMessage. Explicit returnImmediately=false can hold a
  dispatch until the peer responds or the existing gateway timeout expires.
  The initial dispatcher processes commands serially per loop; additional
  PostgreSQL workers can claim other commands concurrently.
- Embedded dispatch requires a long-running Node server. External dispatch
  requires PostgreSQL, shared artifacts, and the initial tsx/dev dependencies.
- Development routes still use the local organization; production identity,
  authorization, actor audit, object retention and content policies remain in
  their assigned phases. Files can remain orphaned after rollback.

Next executable slice: **2.2 — worker-owned subscriptions**. Persist
subscription intent/leases, reconnect and ingest independently of browser
lifetimes, and verify worker restart, input-required prompts, and artifacts.
Do not begin webhook or reconciliation implementation in the same slice.

## Phase 2 Slice 2.2 verified evidence

Date: 2026-10-03

Slice: **2.2 — worker-owned subscriptions**

Changes:

- Added subscription intent, its migration and organization-scoped repository.
  Intent commits atomically with task ingestion; migration adopts already-active
  tasks. Direct Messages never receive subscription intent. Paused/terminal
  tasks stop observation; a command returning active state re-arms it.
- Added a shared application worker and SDK adapter with leased claims,
  five-second heartbeat renewal, fifteen-second expiry, safe reconnect/backoff,
  fenced ingestion and graceful abort/release. A stream event must match its
  leased task before ingestion. Late events after cancellation or lease loss
  cannot commit projections or protocol events.
- Added a pool of eight concurrent subscriptions alongside command dispatch in
  the embedded PGlite owner and separate PostgreSQL worker. Added the
  `worker:tasks` command while preserving `worker:commands`. ADR 0008 records
  runtime, replay and browser-view semantics.
- Replaced browser-owned remote subscriptions with committed projection/event
  reads. Browser reconnect resolves an already-observed scoped task. Added an
  indexed event sequence cursor and persisted safe transport/extension metadata.
  Chat uses authoritative snapshots so replayed diagnostic events do not repeat
  old transitions/prompts in browser caches. Binary content remains externalized.
- Scoped identical command response snapshots to command identity and
  untimestamped lifecycle events to persisted user turns. Reconnect replay
  within a turn deduplicates while later replies can pause on the same prompt.
- Updated deployment, data-model, roadmap and environment documentation. Webhook,
  reconciliation and projection rebuild implementations were not started.

Verification commands and results:

- Before implementation, the Slice 2.1 quality gate passed against PGlite and
  PostgreSQL 18: 36 unit tests, 14 database tests, lint, schema, build and both
  production HTTP profiles. A disposable PostgreSQL 18 container supplied the
  test database and was removed after verification.
- `A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test npm run check`:
  passed lint without warnings; 13 unit files and 39 tests; 6 database files and
  16 tests against PGlite/PostgreSQL 18; schema check; production build; and
  production HTTP verification using both actual worker entry points.
- Shared subscription contract verifies atomic intent/rollback, two-worker claim
  races, database owner restart and lease expiry, stable repeated-byte artifact
  replay, input prompts, reply re-arming, repeated prompts in new turns,
  cancellation fencing, foreign stream identities, tenant-scoped tasks,
  organization-scoped event feeds, redacted errors, unsupported streaming and
  graceful quiet-stream shutdown. Unit tests verify quiet lease renewal/loss
  and authoritative chat snapshots without duplicated historical transitions.
- Production HTTP tests close the browser immediately after command acceptance
  and verify later prompts/artifacts. They reconnect a prematurely ended stream,
  replay repeated chunks without duplication, and kill/restart the actual PGlite
  owner or PostgreSQL worker while a quiet stream is leased. Recovery reaches
  auth-required with one prompt and the assembled `AAB` artifact. Existing task
  scope, cancellation, binary download and independent-reader checks also pass.
- `npm run db:migrate`: applied the subscription migration locally.
  `npm run db:schema:check` and `npx tsc --noEmit` passed; `git diff --check` passed.
- `npm audit --omit=dev`: zero vulnerabilities. Full `npm audit` reports five
  high-severity advisories in the existing development-only ESLint chain through
  braces ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)).
  The suggested force fix downgrades Next.js lint tooling; it was not applied.

Migration tested from:

- Clean PGlite and PostgreSQL 18 databases through all five migrations, including
  rollback/reapply and no schema drift.
- The immediately previous command schema on file-backed PGlite containing an
  active task. Upgrade preserves identity/state/content and adds pending
  observation intent automatically.
- Full database-owner and actual production worker process restart with stored
  task projections, artifact objects and subscription leases recovered.

Remaining risks:

- Phase 2 remains in progress. Webhooks, reconciliation, versioned projection
  rebuild, application SSE freshness signals and remaining browser-cache
  authority removal are later slices. Browser compatibility views are bounded
  and may reconnect; server ingestion is independent of those views.
- Streaming requires advertised support. Unsupported peers stop with a safe
  operational error and await future reconciliation support. Arbitrary partial
  artifact replay without source identity remains ambiguous under the existing
  occurrence/turn fallback. Unknown command outcomes are still not resent.
- The initial per-worker pool is eight streams; gateway timeout expiry reconnects
  streams. Crash recovery can wait up to fifteen seconds for lease expiry.
  Local embedded workers require a long-running Node process. External workers
  require PostgreSQL, shared artifacts and the current tsx/dev dependencies.
- Development local identity, production authorization, content/retention policy,
  full workflow audit and orphaned-object cleanup remain in their assigned phases.
  The development dependency audit finding above remains outstanding.

**Slice 2.2 acceptance criteria are verified. Phase 2 remains active.**

Next executable slice: **2.3 — authenticated push delivery**. Implement
expected-task-scoped authenticated webhook receipt and durable push-config
lifecycle, with duplicate/authentication/scope/restart tests. Do not start
reconciliation or projection rebuild in that slice.

## Phase 2 Slice 2.3 verified evidence

Date: 2026-10-03

Slice: **2.3 — authenticated push delivery**

Changes:

- Added task push registration persistence, its migration, narrow application
  ports, SDK gateway, lifecycle worker and embedded/external runtime integration.
  Configured workers adopt existing nonterminal tasks. New intent commits with
  ingestion; direct Messages receive none. Input/auth-required retains push;
  terminal tasks and disabled agents schedule deletion.
- Added stable remote config IDs, bounded leases/renewal, fenced completion,
  redacted retry state and restart recovery. GetConfig confirms a prior create
  after a lost response, preventing a second registration. Concurrent terminal
  ingestion wins over an in-flight create and preserves cleanup intent.
- Added POST /api/webhooks/a2a/<registration UUID>. Authentication precedes body
  parsing. Callback identity binds organization, agent, tenant, task and expected
  context; the ingestion transaction locks and rechecks it. Canonical A2A 1.0
  StreamResponse events and explicit v0.3 Task snapshots enter common ingestion.
- Credentials derive from a server-only 256-bit signing key and registration
  identity; no secret values are stored in rows, ledger events or browser state.
  Config origin requires HTTPS with an explicit loopback development exception.
  Added durable 120-per-minute per-registration rate windows, bounded JSON body
  parsing and acknowledgement after commit. Terminal tasks ignore late valid
  updates; deleted/disabled registrations reject callbacks.
- Added replay fingerprints and optional hashed X-A2A-Delivery-ID identities for
  repeated append bytes, externalized binary content and rollback verification.
  Added ADR 0009 and configuration/deployment/data-model documentation.
  Reconciliation and projection rebuild were not implemented.

Verification commands and results:

- Before implementation, the Slice 2.2 full quality gate passed on PGlite and
  PostgreSQL 18: 39 unit tests, 16 database tests, lint, schema check, production
  build and both production HTTP worker profiles. A disposable PostgreSQL 18
  container supplied the isolated test database.
- `A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test npm run check`:
  passed lint; 16 unit files and 44 tests; 7 database files and 18 tests on
  PGlite/PostgreSQL 18; schema check; build; production HTTP in both profiles.
- The shared push contract verifies atomic intent/rollback, no fake direct Task,
  two-worker claim races, concurrent duplicate callbacks, distinct append IDs,
  prompt/file replay, malformed/authentication/body-limit rejection,
  organization/agent/tenant/context isolation, full callback rollback and retry,
  durable rate limits, database-owner restart, expired leases/fenced completion,
  prior-task adoption, agent disablement, concurrent cancellation/registration,
  cleanup, safe retries and unsupported-peer error redaction. Unit tests verify
  key isolation/rotation, config validation, payload routing and heartbeat loss.
- Production HTTP uses the official SDK for config get/create/delete and the
  actual Next webhook route. A fixture accepts a config then drops its response;
  recovery confirms the same config rather than creating another. Authenticated
  repeated binary/prompt callbacks produce one artifact/prompt after web and
  worker restart. Foreign identity/authentication and malformed envelopes fail
  closed; completion deletes the remote config and subsequent callbacks fail.
  Browser-visible projections and process logs contain no callback credentials.
- `npm run db:migrate`: applied the push migration to the local database.
  `npx tsc --noEmit` and `git diff --check` passed.
- `npm audit --omit=dev`: zero vulnerabilities. Full `npm audit` still reports
  the same five high-severity advisories in the development-only ESLint chain
  through braces (GHSA-vfj7-8cjw-p6xm). No forced tooling downgrade was applied.

Migration tested from:

- Clean PGlite and PostgreSQL 18 through all six migrations; rollback/reapply
  and schema drift checks pass.
- The immediately previous subscription schema on file-backed PGlite with an
  existing task and subscription. Upgrade preserves state/content/identity;
  push rows remain absent until explicitly configured worker adoption.
- Complete database-owner, production web and external worker restarts with
  stored registration identities, projections, artifacts and rate windows.

Remaining risks:

- Phase 2 remains active: task reconciliation, versioned projection rebuild,
  freshness signals and remaining browser-cache authority removal are pending.
- Config IDs must be honored by the peer. Without a stable delivery ID, identical
  webhook append chunks within a user turn are ambiguous and collapse; complete
  artifact snapshots are preferred. Cross-source arbitrary replay convergence
  remains subsequent reconciliation/projection work.
- Push requires an externally reachable configured callback origin and the same
  signing key on web/workers. Managed CredentialVault, automatic key rotation,
  perimeter/IP rate controls and full Plane A/B authorization remain Phase 3.
  Operator rotation/disablement must remove old remote configs/local registrations
  before resuming with new configuration. Agent network unavailability can delay
  remote deletion; local callback rejection remains effective.
- Embedded PGlite requires a long-running Node server. The filesystem store can
  retain orphaned objects after failed transactions. Existing dev audit findings
  remain outstanding.

**Slice 2.3 acceptance criteria are verified. Phase 2 remains active.**

Next executable slice: **2.4 — task reconciliation and sync cursors**. Implement
worker-owned GetTask/ListTasks reconciliation behind gateway/repository ports,
with durable scheduling/cursors and missed-event/restart/scope tests. Preserve
uncertain-command safety: do not automatically resend unknown remote outcomes.
Do not begin projection rebuild or application freshness SSE in that slice.

## Phase 2 Slice 2.4 verified evidence

Date: 2026-10-03

Slice: **2.4 — task reconciliation and sync cursors**

Changes:

- Added reconciliation gateway, repository, unit-of-work and ingestion ports,
  worker service and bounded pool in both embedded PGlite and external
  PostgreSQL task workers. The official SDK performs GetTask/ListTasks reads.
- Added scoped sync cursors for per-task GetTask scheduling and per-scope
  ListTasks pagination. Intent commits with ingestion; migration adopts existing
  nonterminal tasks. Direct Messages have no cursor. Paused input/auth-required
  work remains polled; terminal work stops its task cursor.
- Added fifteen-second leases/five-second heartbeats, fenced page checkpoints,
  safe retries and restart recovery. GetTask repeats after fifteen seconds;
  complete ListTasks sweeps after sixty seconds. Full sweeps request history and
  artifacts, avoiding status-only watermarks that miss artifact-only changes.
  Unsupported listing, including explicit v0.3 SDK errors, leaves GetTask active.
- Routed snapshots through common ingestion. Task/context/optional tenant
  identity validates before commit. A pre-read task version check under the task
  lock makes concurrent updates win. Older timestamps cannot regress content.
  A lost lease rolls back the observation and prevents checkpoint advancement.
  Only known scoped tasks are updated from lists; unknown initial-send outcomes
  stay uncertain, without resending or guessing a correlation.
- Added ADR 0010 and architecture/data-model/runtime documentation. All event
  sources now use common ingestion; arbitrary cross-source replay convergence
  and versioned projection rebuild remain the next slice. No application SSE or
  browser-cache authority removal was implemented.

Verification commands and results:

- Before implementation, the full Slice 2.3 gate passed: lint, 44 unit tests,
  18 database tests on PGlite/PostgreSQL 18, schema check, production build and
  both production HTTP worker profiles. A disposable PostgreSQL 18 container
  supplied the isolated test database.
- `A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test npm run check`:
  passed lint; 18 unit files/47 tests; 8 database files/20 tests on PGlite and
  PostgreSQL 18; schema drift check; build; production HTTP in both profiles.
- The shared reconciliation contract verifies atomic intent/rollback, direct
  Message exclusion, missed prompts/auth states and binary content, duplicate
  snapshot ingestion, durable page checkpoints and database-owner restart,
  organization/agent/tenant remote-ID collisions, unknown-task exclusion,
  invalid identity/context/tenant rejection, safe errors, unsupported listing,
  expired ownership/reclaim, two-worker races, concurrent cancellation, lost
  lease rollback, failed-page checkpoint safety, stale content preservation,
  polling fallback and preservation of uncertain commands after a list read.
- Unit tests verify scoped SDK parameters, pagination/artifact requests,
  explicit v0.3/unsupported envelope classification, transient failures and a
  quiet read abort on heartbeat ownership loss.
- Production HTTP exercises a peer with no streaming/push support through the
  actual Next command/query routes and SDK GetTask/ListTasks. It recovers a
  missed input request and binary artifact, advances list pagination, ignores
  unrelated listed work and converges to completed after crashing/restarting
  the PGlite owner or PostgreSQL worker. Existing streaming/reconnect,
  cancellation, push lifecycle/replay and browser-disconnect checks also pass.
- After strengthening the uncertain-command test, the focused reconciliation
  contract passed again on both databases. `npx tsc --noEmit` and
  `git diff --check` passed. `npm run db:migrate` applied the local migration.
- `npm audit --omit=dev`: zero vulnerabilities. Full `npm audit` reports the
  same five high advisories in the development-only ESLint/braces chain
  (GHSA-vfj7-8cjw-p6xm); no forced tooling downgrade was applied.

Migration tested from:

- Clean PGlite and PostgreSQL 18 through all seven migrations, with
  rollback/reapply and schema drift verification.
- Immediately previous push schema on file-backed PGlite with retained task
  and subscription identity/state/content. Upgrade creates one task schedule
  and one scoped list cursor, preserves the task/subscription and leaves push
  registration absent until configured.
- Database-owner and production worker restarts with persisted pagination,
  pending schedules, expired read leases and artifact objects.

Remaining risks:

- Phase 2 remains active. Versioned projections/rebuild, cross-source replay
  correction, application freshness SSE and remaining browser authority removal
  are pending.
- Full scoped sweeps trade read traffic for artifact convergence; pagination is
  peer-owned and can expire or shift. Failed pages restart the sweep; GetTask
  polling preserves known-task convergence. Terminal tasks are not reopened.
- ListTasks only updates known tasks before production authorization exists.
  A lost initial send cannot safely be associated with an arbitrary listed task;
  explicit command recovery policies and operational UI remain later work.
- Existing PGlite single-owner/long-running-server requirements, potential
  orphaned immutable artifact files and development dependency audit findings
  remain unchanged. Plane A/B credentials/policy remain Phase 3.

**Slice 2.4 acceptance criteria are verified. Phase 2 remains active.**

Next executable slice: **2.5 — versioned projections and rebuild**. Implement
versioned task/message/artifact projections and deterministic ledger/archive
rebuild with duplicate/out-of-order/restart/scope tests behind existing ports.
Do not begin application freshness SSE or browser-cache authority removal.

## Phase 2 Slice 2.5 verified evidence

Date: 2026-10-03

Slice: **2.5 — versioned projections and rebuild**

Changes:

- Added projector version 2 and normalized task-header/message/artifact tables,
  scoped by organization/local task/projector version with stable derived UUIDs.
  Typed Task columns remain the indexed inbox; detail reads use a single SQL
  snapshot of the active pointer and normalized content. Legacy tasks remain
  readable until observation or explicit rebuild activates version 2.
- Ingestion and rebuild share one deterministic retained-ledger reducer. It
  ignores old projection content, derives missing message IDs from normalized
  content/turn, merges overlapping append occurrences across sources, preserves
  distinct same-source occurrences and rejects stale snapshots/terminal
  regression. Full artifact snapshots correct assembled content.
- Added narrow rebuild ports, service, runtime composition and an operator CLI.
  Preparation uses a repeatable-read ledger capture and verifies original binary
  archive/object digests and scope. Original bytes regenerate binary references,
  digest/object-key/size metadata. Missing/corrupt/foreign archives and empty
  ledgers fail before activation. Missing normalized rows are repairable.
- Activation locks the task and checks its captured version, atomically replaces
  content rows and switches the active pointer. Concurrent ingestion forces
  bounded recapture/retry; interrupted activation rolls back. Reads stay available
  during preparation. Rebuild writes no events and dispatches no commands,
  subscriptions, push registrations or reconciliation reads.
- Added ADR 0011, migration, rollback export, runtime/operator and data-model
  documentation. PostgreSQL supports online rebuild; PGlite uses its existing
  runtime owner or the offline CLI after web stops. Application freshness SSE
  and browser-cache authority removal remain subsequent slices.

Verification commands and results:

- Before implementation, the complete Slice 2.4 gate passed: lint, 47 unit tests,
  20 database tests on PGlite/PostgreSQL 18, schema check, production build and
  both HTTP worker profiles. Existing work was committed/pushed as `bf7c806`.
- `A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test npm run check`:
  passed lint; 19 unit files/52 tests; 9 database files/22 tests on PGlite and
  PostgreSQL 18; schema drift check; production build; HTTP in both profiles.
- The shared rebuild contract verifies upgrade with retained original binary
  archives, deterministic repeated rebuild and stable message row identity,
  corruption/missing-row repair, ledger immutability, read availability during
  delayed archive loading, concurrent ingestion/retry, missing/corrupt archive
  rejection, direct Message and uploaded binary reconstruction, transactional
  activation rollback, empty-ledger rejection, agent/tenant/organization remote-ID
  collisions, cross-source duplicate chunks, stale snapshots, authoritative
  artifact replacement and database-owner restart.
- Unit tests verify deterministic sequence ordering, cross-source turn/occurrence
  deduplication, no-ID history/status convergence across dialect roles/parts,
  prompt classification, timestamped prompts followed by untimestamped replies,
  repeated snapshot correction, stale snapshot/terminal fences and foreign
  ledger, remote-task, context and tenant rejection.
- Production HTTP runs the real rebuild CLI twice against a completed binary
  reconciliation task, while PostgreSQL web/workers remain online or after
  releasing the PGlite owner. Task detail and downloaded bytes remain identical;
  no sends occur. Existing browser disconnect, streaming/reconnect, prompts,
  cancellation, push replay/lifecycle and process restart scenarios still pass.
- After adding missing-projection repair, stable-ID and complete organization
  collision coverage, the focused rebuild contract passed again on both
  databases. TypeScript, lint and the production build passed again.
- `npm run db:migrate`: applied the new local migration. `git diff --check`
  passed. `npm audit --omit=dev`: zero vulnerabilities; existing development
  tooling advisories remain outside this slice.

Migration tested from:

- Clean PGlite and PostgreSQL 18 through all eight migrations, with schema drift
  verification and rollback/reapply.
- Immediately previous reconciliation schema on both databases with retained
  task identity, content, event digest and original binary archive. Upgrade
  preserves version 1 reads; explicit rebuild activates normalized version 2.
- Version 2 rollback exports the active header/messages/artifacts into legacy
  content before dropping tables. Re-upgrade/rebuild preserves visible content.
- File-backed database-owner restart and production HTTP process restarts retain
  content and binary references.

Remaining risks:

- Phase 2 remains active: application freshness SSE and remaining browser
  task-content/notification authority removal are pending.
- Without shared source sequence/delivery identities, identical untimestamped
  append chunks across sources are ambiguous. The conservative overlapping
  occurrence policy can collapse distinct cross-source chunks; full snapshots
  provide correction. It cannot infer unavailable protocol ordering.
- Accepted observations currently reduce the full per-task ledger. Very large
  retained histories need incremental checkpoints/retention optimizations in
  later scaling work; indexed query reads do not scan protocol events.
- Rebuild requires retained events and matching artifact backups. PGlite retains
  its single-owner/long-running-server requirement, and immutable file writes
  before failed transactions can leave orphaned objects. Production credentials,
  authorization, retention and operational UI remain in their assigned phases.

**Slice 2.5 acceptance criteria are verified. Phase 2 remains active.**

Next executable slice: **2.6 — application SSE freshness signals**. Publish
committed durable-state changes through a retryable outbox/freshness adapter and
make browser consumers re-query scoped projections. Verify disconnect, missed
signal recovery and both deployment profiles. Do not remove remaining browser
persistence authority in this slice.

## Phase 2 Slice 2.6 verified evidence

Date: 2026-10-03

Slice: **2.6 — application SSE freshness signals**

Changes:

- Added framework-independent freshness ports, transactional `task.freshness`
  outbox intent, dispatcher and worker loop. Accepted observations and rebuild
  activation commit empty-payload intent with projections. Duplicate ingestion
  creates no additional intent. Direct Message projections also publish.
- Added fifteen-second delivery leases, owner fencing and safe retry state with
  bounded backoff. A publication whose acknowledgement was lost may repeat;
  expiry permits retry without dispatching remote work or changing task content.
- Added a process-global organization-token adapter for embedded PGlite and an
  indexed persistent organization-token adapter for PostgreSQL workers/web
  replicas. Tokens are opaque equality markers; there is no replay cursor or
  global protocol-event sequence assumption. Added migration and ADR 0012.
- Added GET /api/tasks/events with server-resolved organization scope,
  content-free ready/freshness/resync frames, backpressure, abort cleanup and
  bounded reconnecting connections. Web routes poll only the freshness adapter;
  remote observation remains worker-owned.
- Tasks list/detail and known durable Chat tasks share one EventSource per tab
  and re-query scoped projections after signals/reconnect, on focus and through
  five-second fallback reads. Bursts coalesce; invalidations during a request
  preserve a follow-up read. Existing browser persistence remains for the next
  slice, including pending user turns and notification read state.

Verification commands and results:

- Before implementation, the complete Slice 2.5 quality gate passed: lint,
  52 unit tests, 22 database tests on PGlite/PostgreSQL 18, schema check, build
  and both production HTTP worker profiles.
- `A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test npm run check`:
  passed lint; 22 unit files/58 tests; 10 database files/24 tests on both
  databases; schema drift check; production build; production HTTP with
  embedded PGlite and external PostgreSQL workers.
- Shared freshness contracts verify atomic intent/rollback, duplicate ingestion,
  direct Messages, rebuild invalidation, two-worker claiming, publication failure,
  safe retries, lost acknowledgement/duplicate publication, expired ownership,
  late acknowledgement fencing, database-owner restart and organization isolation.
- Unit tests verify initial/reconnected ready, missed-signal resync, duplicate
  bursts, independent organization tokens, bounded lifetime, abort cleanup,
  backpressure, safe stream failures, one EventSource per tab and follow-up reads
  after invalidations during an in-flight request.
- Production HTTP verifies two independent SSE readers followed by durable
  re-queries, content-free frames, cache headers, ignored client scope/cursor
  selectors, observation with zero live browsers, missed-signal recovery and
  fresh reads after process restart in both worker profiles. Existing streaming,
  prompts, cancellation, push, reconciliation and binary rebuild scenarios pass.
- The first expanded gate exposed an older rollback test that assumed the newest
  migration was the projection migration. It now explicitly targets the previous
  reconciliation schema; the complete gate then passed.
- Browser verification rendered the durable task history, input-required prompt
  and binary artifact in Task detail and Chat without console errors. A fixture
  cancellation committed through the API changed the already-open Chat to
  CANCELED without navigation or manual refresh, again without console errors.
- `npm run db:migrate` applied the local migration. `npx tsc --noEmit` and
  `git diff --check` passed. `npm audit --omit=dev`: zero vulnerabilities.

Migration tested from:

- Clean PGlite and PostgreSQL 18 through all nine migrations, with rollback,
  reapplication and schema drift checks.
- Immediately previous versioned-projection schema on both databases with a
  retained task. Upgrade preserves content/identity. Freshness rollback removes
  only adapter tokens and freshness outbox rows; task/event projections remain.
- Prior projection rollback still exports normalized content correctly, with
  freshness migration removed first. Restart retains pending delivery intent and
  shared PostgreSQL tokens; local bus restart recovers through ready/re-query.

Remaining risks:

- Phase 2 remains active: task-content/notification browser persistence authority
  removal and final phase exit verification are pending. Chat freshness currently
  refreshes known durable local IDs; it does not import old browser-only history.
- The polling adapter currently reads one indexed token per SSE connection;
  larger deployments may share organization polling/fan-out behind the same port.
  Tokens intentionally coalesce changes and provide no event replay guarantee.
- Local PGlite still requires its single long-running owner. PostgreSQL workers
  require shared artifacts and database configuration. Existing projection
  ordering/retention limits, potential orphaned files, development tooling audit
  advisories and Phase 3 authentication/authorization scope remain unchanged.

**Slice 2.6 acceptance criteria are verified. Phase 2 remains active.**

Next executable slice: **remaining Phase 2 browser persistence authority
removal**. Resolve the next unchecked deliverable in PHASES.md, remove task
content and notification authority from browser persistence, and verify the
Phase 2 exit criteria before advancing to Phase 3.

## Phase 2 Slice 2.7 and phase exit verified evidence

Date: 2026-10-03

Slice: **2.7 — browser persistence authority removal**

Changes:

- Replaced Zustand task/read persistence with a disposable in-memory projection
  cache and session-only read presentation state. Retire task/notification keys
  in both browser namespaces on mount; do not hydrate or import browser-only
  history. Settings/theme preferences retain their storage.
- Added a narrow content-pagination repository/query port and GET
  `/api/task-views`, scoped by the existing server-resolved local organization.
  Local UUID cursors include direct Messages as well as real Tasks. Queries read
  active content projections, not protocol events; the task-only inbox is unchanged.
- A single tab cache completes every page before activation and replaces its
  prior content. Chat, flows and current alerts load without a previously visited
  task or browser cache. Freshness/reconnect/focus and five-second fallback
  reads discover new tasks and recover missed signals. Partial failures retain
  the previous view with a visible retry warning; initial failures do not claim
  a missing conversation.
- A send racing a paginated read fences cache replacement and schedules another
  read. Database snapshot versions reject delayed older command-stream views.
  Pending user turns live only in the composer; raw diagnostic events never
  create task content or permanent phantom messages. Cancellation re-queries the
  committed view instead of manufacturing local transitions. New tasks within
  an existing conversation preserve its tenant.
- Alerts derive from durable task projections; notification read marks are
  session-only presentation state. Durable recipient/read records, historical
  notification delivery and external channels remain Phase 4 work. Existing
  architectural decisions are preserved; no new ADR or migration is needed.

Verification commands and results:

- Before implementation, the complete Slice 2.6 `npm run check` gate passed:
  lint, 58 unit tests, 24 database tests on PGlite/PostgreSQL 18, schema check,
  production build and both production HTTP worker profiles. The first attempt
  found the prior PostgreSQL test endpoint unavailable; a disposable PostgreSQL
  18 instance restored the full prerequisite verification.
- The expanded `npm run check` passed lint, 24 unit files/66 tests, 10 database
  files/24 tests on both databases, schema drift check and production build.
  HTTP then exposed a test assumption that every no-op rebuild advances the
  ORM version. The assertion now verifies a non-regressing version and identical
  deterministic content; rebuild content tests exclude operational revision.
- `A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test A2A_HTTP_TEST_KEEP_SERVER=true npm run test:http`:
  passed embedded PGlite production HTTP and remained available for browser QA;
  graceful SIGINT completed fixture cleanup with exit code zero.
- `A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test A2A_HTTP_TEST_PROFILE=postgresql npm run test:http`:
  passed external PostgreSQL production HTTP and cleaned up its temporary database.
- Shared database contracts verify complete content pagination, direct Messages,
  scoped remote-ID/context collisions, foreign-organization exclusion, derived
  alerts, binary references and reconstruction after database-owner restart.
- Unit tests verify all-page reads, failed partial reads, cursor-loop rejection,
  selective legacy-key retirement, disabled storage, absence of persistence
  writes, removal of phantom messages/deleted cache entries, concurrent-send
  fencing, failure/recovery state and delayed snapshot rejection. Raw protocol
  events before the first snapshot cannot become authoritative UI content.
- Production HTTP verifies two independent clean-session content reads after
  restart, two-item pagination, direct replies outside the task-only inbox,
  ignored client organization/tenant selectors, invalid pagination rejection,
  no-store headers and committed cancellation in content pages. Existing
  streaming/reconnect, prompts, push, reconciliation and rebuild scenarios pass.
- Browser QA verified Chat landing, direct conversation reload, prompts/binary
  artifacts, current alerts and orchestration reload without stored history.
  An independent fixture session committed cancellation; already-open Chat
  changed to CANCELED without navigation/refresh. A composer send produced a
  direct Message and its user/agent content survived a full reload. No browser
  console warnings/errors appeared in these checks.
- `npm run lint`, `npx tsc --noEmit` and `git diff --check`: passed.
  `npm audit --omit=dev`: zero vulnerabilities.

Migration tested from:

- No Slice 2.7 schema change. The full shared migration suite still verifies
  clean databases, previous-schema upgrades, rollback/reapplication and schema
  drift on PGlite and PostgreSQL 18. Prior Slice 2.6 changes remain preserved.

Phase 2 exit criteria verified:

- Commands and observation continue after every browser disconnects, including
  the accepted-command/disconnected-stream production scenarios.
- Web/worker crashes recover subscriptions, push lifecycle and reconciliation;
  task content remains queryable after process restart in both profiles.
- Duplicate and out-of-order stream/push/reconciliation events and repeated
  rebuilds preserve visible messages, prompts and assembled artifacts.
- Missed live signals recover through ready/re-query/fallback; clean browsers
  reconstruct Chat, flow and alert content from server projections.
- Streaming/reconnect, input/auth-required, cancellation and binary artifact
  assembly pass through the actual production web server and SDK fixture agents.

Remaining risks:

- The initial tab cache reads all organization content pages on refresh. Larger
  workloads need scoped conversation/inbox queries and selective content loading
  behind the same repository boundary. Pagination is eventually consistent during
  concurrent writes; subsequent complete refreshes converge.
- Browser-only history without a server record is unavailable and is not imported.
  Session read marks reset on full reload; durable per-user read/notification
  features remain explicitly scheduled for Phase 4.
- Phase 3 authentication, credential vault, grants and network hardening remain
  unimplemented. The current organization boundary is the development organization.
  Existing ambiguous append ordering, retained-ledger/archive requirements,
  orphaned file lifecycle and PGlite single-owner limitations remain.

**Slice 2.7 and all Phase 2 exit criteria are verified. Phase 2 is complete.**

Next executable slice: **Phase 3 identity/session adapters**. Resolve the first
unchecked Phase 3 deliverable in PHASES.md and follow ADR 0005/SEC-001 for local
development identity and production OIDC sessions before moving to credential
vault and scoped authorization work. Phase 3 is active but remains Planned until
implementation begins.

## Phase 3 combined Slice 3.1 verified evidence

Date: 2026-10-03

Slice: **3.1 — Plane A identity and organization access**

Changes:

- Combined related identity/session, persistent membership, organization-role,
  route authorization, administrative catalog and transactional audit work.
- Added pinned `openid-client` 6.8.8 for OIDC discovery, PKCE, state, nonce,
  issuer/audience/expiry and ID-token signature validation, and `jose` 6.2.12
  for authenticated encryption of short-lived server-side login attempts.
- Added users, exact issuer/subject external identities, organization memberships,
  hashed opaque sessions, one-use encrypted login attempts and safe audit facts.
  Memberships are operator-provisioned; provider role/organization claims never
  grant access. No provider tokens reach the browser or persist in these tables.
- Added fail-closed production configuration, explicit development identity,
  secure host cookies, login/session/logout routes and a safe identity menu.
- All application read/mutation routes authenticate before data access. Scoped
  repositories use the admitted organization; viewer/operator/admin permissions
  protect commands and administration. Existing webhooks retain their separate
  authenticated push boundary. OIDC mutations require the canonical Origin.
- Added operator provisioning CLI, accepted ADR 0013 and repository threat model.
  Session creation, revocation, catalog mutations and accepted-command audits
  commit transactionally with the associated operation.

Verification commands and results:

- Verified Phase 2 prerequisites with the existing full quality gate before
  implementation. Existing uncommitted Phase 2 work remains preserved.
- `A2A_DATABASE_PROFILE=postgresql A2A_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test npm run check`:
  passed lint, 26 unit files/73 tests, 11 database files/26 tests across PGlite
  and PostgreSQL 18, schema drift check, production build and both existing
  task-runtime and new identity HTTP suites on both profiles.
- Signed-token tests cover incorrect issuer, audience, nonce, state, expiry and
  signature. JWE tampering/wrong-key, current membership/user/role validation,
  expiry/revoke, replay and concurrent one-use login behavior fail closed.
- Actual production HTTP OIDC fixture verifies secure cookie flags, login replay,
  unprovisioned users, canonical origins, anonymous route rejection, viewer and
  operator restrictions, administrative registration, cross-organization task,
  command and artifact access, accepted-command audits, restart, logout and
  revoked memberships. Secrets are absent from inspected responses/logs and
  session/login/audit storage. Provider role claims do not override local roles.
- Browser QA verified the development identity/role label and loaded Tasks
  presentation, with no console warnings/errors. Its temporary tab was closed
  before runtime restart verification completed.
- `git diff --check`: passed. `npm audit --omit=dev`: zero vulnerabilities.
- Fixed audit FK schema drift by explicitly preserving actor references with
  `ON DELETE NO ACTION`; final adapter, schema and full runtime checks pass.

Migration tested from:

- Clean file-backed PGlite and PostgreSQL 18 through all ten migrations.
- Previous Phase 2 schema containing agent/task data, upgraded while preserving
  existing records; rollback/reapplication and close/reopen contracts pass.
- The actual existing `.data/pglite` could not open: PostgreSQL reported an
  invalid checkpoint record and could not locate a valid WAL checkpoint.
  The same directory had failed ORM migration generation before implementation.
  No reset/replacement was performed. An offline filesystem copy is preserved
  at `.data/backups/pglite-before-phase3-migration-20261003` (also initially
  copied to `/tmp/a2a-pglite-preserved-20261003-143621`). The local development
  listener was restarted on port 3002, but returns identity-service 503 until
  that existing database is safely recovered or explicitly replaced. Local
  migration is not claimed as successful; isolated adapter/runtime tests pass.

Remaining risks:

- Organization roles are the baseline; teams and agent/skill grants, the
  credential vault/service identity, connection-bound network policy, rate
  limits and Agent Card signature verification remain unchecked Phase 3 work.
- Already-admitted requests/accepted durable commands may finish after session
  revocation. New requests revalidate membership/user/session state.
- The existing local database recovery issue requires a separate safe recovery
  decision; resetting WAL or discarding stored tasks is not automatic.

**Combined Slice 3.1 is verified. Phase 3 remains In progress.**

Next executable slice: **3.2 — Plane B credentials and scoped security**.
Implement trusted-library-backed encrypted service credentials and scoped grants
behind application ports, then verify protected-agent and secret-disclosure gates
alongside the remaining network/artifact/trust controls.

## Phase 3 combined Slice 3.2 verified evidence

Date: 2026-10-03

Slice: **3.2 — Plane B credentials and scoped security**

Changes:

- Combined encrypted CredentialVault/service connections, team/member/organization
  agent/skill grants, admin settings, network policy, artifact authorization,
  durable rate budgets and signed-card trust behind application ports.
- Reused jose JWE/JWS and SDK card canonicalization, openid-client client credentials,
  and pinned Undici 7.30.0/ipaddr.js 2.5.0. No custom cryptographic/signature protocol.
- Credential CLI uses bounded stdin, server environment keys, old-key decrypt/active-key
  re-encryption, credential replacement and fail-closed revocation. Browser APIs expose
  status only. API key, bearer, OAuth client and mTLS have real TLS fixture proof.
- Members need explicit agent or skill access. SQL filters apply before pagination;
  direct task/command/artifact and compatibility routes recheck policy. Skill-only sends
  need the explicit reviewed routing extension, immutable typed task/command identity,
  server metadata and scoped context/reference checks. Admins retain full org access.
- Exact production HTTPS origins, independently bound credential origins, actual socket
  DNS validation, mapped-IP/metadata rejection, redirect denial and bounded streaming
  responses protect all HTTP agent paths. Wire facts exclude headers/bodies; credential
  echoes, including binary parts and sidebands, are redacted before persistence. Protected
  operation/stream failures use safe messages. SDK verification logging is avoided by
  using its canonicalization with jose verification.
- Artifact downloads require server-authored digest references and a currently visible
  task, with attachment/nosniff/no-store/sandbox. Remote media is not automatically loaded.
  Projection rebuild verifies original archives outside transactions and atomically
  restores trusted references with activation. Forged URLs/metadata cannot grant access.
- Admin Settings creates teams, manages membership and grants/revocation, and displays
  credential status. Protected cards can be registered by URL before server credential
  provisioning; the dialog no longer implies that a scheme choice configures authentication.
- Accepted ADR 0014 and updated architecture, model, threat model, environment example
  and the service identity/rotation/migration runbook.

Verification commands and results:

- Reverified all Phase 2/3.1 prerequisites before implementation using the full quality
  gate on a disposable PostgreSQL 18 server. Preserved existing uncommitted changes.
- `A2A_DATABASE_PROFILE=postgresql A2A_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/a2a_ops_test npm run check`:
  passed lint, 28 unit files/81 tests, 12 database files/28 tests across PGlite and
  PostgreSQL, no schema drift, production build, TLS service agent fixtures and both
  task-runtime and OIDC/protected-agent HTTP suites on both database profiles.
- Real TLS SDK fixtures prove API key, bearer, OAuth client and mTLS, valid/tampered
  signed cards, origin binding, no redirect forwarding, oversized responses and
  credential echoes. Added protected failure-response checks also pass.
- Unit regressions prove actual socket DNS rebinding rejection after a public preflight,
  mixed DNS answers, mapped metadata IPs, chunked response limits, scoped card filtering,
  viewer ceilings, known-secret binary/key redaction and expired/foreign card key pins.
- Shared database contracts prove no-grant discovery/invocation denial, team revocation,
  skill/generic/context/reference denial, server routing override, filtered pagination,
  hidden artifacts and forged references; vault tamper/wrong-key/cross-agent substitution,
  encryption rotation/revocation/restart, audit secrecy and rate-window reset.
- Production HTTP combines actual OIDC with an encrypted protected bearer agent. A same-org
  ungranted user cannot use catalog/detail/task/artifact or command/message/stream URLs.
  Cross-org denial, viewer/operator ceilings, origin, login replay, restart/logout,
  accepted command audit and browser response/log/session/audit disclosure checks pass.
- Fixed optional SDK arrays and normalized cards before execution. Browser QA also
  caught and fixed Next localhost/127.0.0.1 development mutation origins; same-port
  loopback aliases are admitted only in development, and OIDC remains exact-origin.
  The task HTTP gate now supplies browser Origin headers. Fixed a real PGlite
  concurrency regression by moving archive reads outside capture transactions; existing
  slow-archive concurrent read/ingestion and rebuild contracts pass.
- Browser QA on a separate disposable PGlite fixture verifies team creation/member
  assignment, a skill grant surviving reload, grant revocation/member removal,
  protected-card URL registration controls and unsigned trust presentation. No
  browser console warnings/errors appeared; the temporary tab/process were closed.
- After the final registration UI and CLI environment-loading refinements, lint and
  production build pass again; `npx tsc --noEmit` passes. Production-only `npm audit`
  reports zero vulnerabilities. `git diff --check` passes.

Migration tested from:

- Clean file-backed PGlite and PostgreSQL 18 through all eleven migrations, including
  close/reopen persistence, schema drift checks, rollback and reapplication.
- The previous identity schema, plus retained Phase 2 tasks/archives upgraded and rebuilt
  with trusted artifact references; rollback retains the previous task data.
- No migration/reset was attempted on the existing corrupt local `.data/pglite`.
  Its offline backups listed under Slice 3.1 remain preserved. The existing development
  listener can still return 503 because of its pre-existing invalid WAL checkpoint.

Phase 3 exit criteria verified:

- Protected agents operate with all four service profiles; browser/log/audit disclosure
  checks pass and no credential plaintext is returned by administrative APIs.
- Missing grants deny discovery and invocation, including direct/compatibility URLs.
  Skill grants cannot authorize generic sends or cross-skill/context/reference work.
- Cross-organization and scoped task/artifact access fail closed on both profiles.
- Wire views use fixed facts, protected errors are safe, and known credential echoes
  are removed before visible protocol content and archives are persisted.

Remaining limits:

- User-delegated OAuth consent/refresh is the explicitly conditional follow-up after
  the verified service baseline; it is not implemented or claimed. ADR 0014 records
  required membership-bound credentials/worker subject selection before that extension.
- gRPC is unavailable until its SDK adapter supports connection-bound DNS validation.
  Unsigned administrative registrations are allowed unless signed cards are required.
- Skill routing requires reviewed agent enforcement. Accepted work and admitted connections
  can finish after grant/session/credential revocation; subsequent requests/connections
  recheck. Host key protection and trusted allowed agent infrastructure remain operational.
- Existing binary archives need projection rebuild for permission backfill. Missing/corrupt
  originals fail closed. The old local WAL recovery issue remains a separate safe decision.

**Combined Slices 3.1/3.2 and every Phase 3 exit criterion are verified. Phase 3 is complete.**

## Phase 4 Slice 4.1 verified evidence

Date: 2026-10-05

Slice: **4.1 — typed decision requests and revisions**

Changes:

- Added the decision aggregate behind application ports: `DecisionRequest`, immutable
  `DecisionRevision` and `Decision`, and `DecisionExecution`, with an ORM-independent
  `DecisionService`, MikroORM repository, migration and ADR 0015.
- Requests are scoped to one A2A task (agent, tenant, skill and task come from the task
  row), expire within 30 days, carry a policy snapshot, and are idempotent per request
  key. Opening supersedes older open requests for the task; finished tasks and direct
  Messages are refused.
- Outcomes `approve`, `reject`, `edit` (new revision, approved), `request_changes` and
  `delegate` record rationale, reviewer, exact revision ID/digest and policy. Reviewers
  must state the revision they read, hold an operate grant (read grant, else 404), be the
  assignee (admins excepted) and, by default, not be the requester.
- Approval commits the decision, execution and an ordinary `TaskCommand` + outbox row in
  one transaction (keys `decision:<id>` / `decision-<id>`), through the same scope and
  skill-routing checks as operator sends, so replays and lost races never dispatch twice.
  Execution status and observed task state are correlated on read.
- Expiry is checked per decision and swept by `expireDue`; expired/superseded requests
  authorize nothing. Decisions and revisions are immutable and execution correlation
  columns are fixed, enforced by database triggers declared on the entities.
- Added `/api/decisions` (list/open), `/api/decisions/[id]` (detail),
  `/revisions` and `/decisions` routes using the existing authenticated-route guard.
  Refactored command acceptance into `acceptCommandWithin` (behavior unchanged).

Verification commands and results:

- `npx tsc --noEmit` and `npm run lint`: passed.
- `A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:5432/a2a_ops_test npm run check`
  passed lint, 28 unit files/81 tests and 13 database files/30 tests on PGlite and
  PostgreSQL. In this sandbox the gate's schema step needs a migrated local database,
  so it was run separately against a freshly migrated PGlite directory: no schema drift.
  `npm run build` passed with all four decision routes. `npm run test:http` then passed
  all suites, including the new decision HTTP suite.
- The shared decision contract verifies scoped/validated/idempotent opening, concurrent
  open, role/grant/foreign-organization denial, separation of duties, stale revisions,
  concurrent and repeated approvals dispatching once, replay with changed input
  rejected, the stored command payload matching the approved revision, observed-state
  correlation, audit actor/time/target, database immutability, edit-before-approve,
  revise/request-changes/reject, delegation, expiry and sweep, supersession by a newer
  request and by task completion, visibility filtering, restart, and migration rollback
  and reapply with no schema drift.
- Production HTTP verifies validation and idempotent open, no agent contact on open,
  concurrent approvals sharing one decision, a single `SendMessage` to the fixture agent
  carrying the edited revision and message ID, and the observed `COMPLETED` state.

Migration tested from:

- Clean PGlite and PostgreSQL through all twelve migrations, with rollback/reapply and
  no schema drift. No existing rows change; the migration only adds tables and triggers.

Remaining risks:

- PostgreSQL verification used the sandbox's PostgreSQL 16 server rather than the
  PostgreSQL 18 service the repository's CI uses; CI should confirm.
- Slice 4.1 has no UI and no agent-originated requests; operators open requests on an
  agent's behalf. Only one typed action (`send_message` into the same task) exists.
- Tasks that end are only discovered at the next decision attempt; there is no sweep
  that supersedes their open requests, and no notification of expiry or supersession.
- Assignment is limited to `delegate`/initial assignee. Claiming, due times, escalation,
  internal notes, audit views and durable notifications are slice 4.2 and later.
- Observed outcomes refresh on read, not on a worker or freshness signal.
- The existing corrupt local `.data/pglite` and the user-delegated OAuth follow-up
  (issue #1) are unchanged.

**Slice 4.1 acceptance criteria are verified. Phase 4 remains active.**

## Phase 4 Slice 4.1b verified evidence

Date: 2026-10-05

Slice: **4.1b — approval review UI**

Changes:

- Added an **Approvals** area using the existing shell, split-pane, chips, cards and
  polling resource hook: a filterable queue (Pending, Needs changes, Assigned, Closed,
  All), a review page, and a pending-count badge in desktop and mobile navigation.
- The review page shows the exact proposed action and digest, the requester, expiry and
  linked task, revision history, the decision record (who, what, when, why, which
  revision) and the delivery result with the observed task state. Approve, Edit
  (edit-before-approve), Reject, Request changes and Delegate are available to a
  permitted reviewer; reject, edit, delegate and request-changes need a rationale.
  Approval asks for confirmation. A requester who may not decide their own request, or a
  reviewer it is not assigned to, sees why instead of dead buttons; the server still
  enforces every rule. A proposer can submit a revised proposal after changes are requested.
- Retried or double-clicked submissions reuse one idempotency key per identical request,
  so they replay the same decision; a changed request gets a new key. A decision always
  names the revision the reviewer saw, so a stale page is refused rather than applied.
- Task pages gain an **Approvals** card and a **Request approval** dialog (title,
  context, message, risk, expiry, optional assignee), because agents cannot yet open
  requests themselves. Actions render through a per-kind registry
  (`proposed-action.tsx`) so new action kinds and Phase 6 structured forms plug in
  without changing the review page.
- Added `GET /api/reviewers` (eligible reviewers for a task's agent/skill) and display
  context on decision views (agent and task names, people names, signed-in viewer).
- Recorded the remaining Phase 4 work as new `HITL-006..008` requirements and Phase 4–7
  deliverables in PRODUCT_SPEC.md and PHASES.md.

Verification commands and results:

- `npx tsc --noEmit` and `npm run lint`: passed. `npm test`: 29 unit files/86 tests,
  including the new approval-helper tests (expiry labels, decidable states, delivery
  wording, idempotency-key reuse).
- `npm run build`: passed with the new pages and routes. The decision HTTP suite
  (`scripts/verify-decisions-http.mjs`) now also checks the reviewer list, display names,
  viewer and people on the production server, and passed.
- Scripted Chromium run against the production build (not committed; the repository has
  no browser test dependency yet): requested an approval from the task page, saw a
  requester blocked from deciding their own request, edited and approved a request and
  watched it reach the fixture agent exactly once with the edited text and the result
  panel show the delivered/working state, rejected one, requested changes then revised and
  delegated another, checked the queue filters, task-page card and navigation badge, and
  checked a 390px mobile layout with no horizontal scroll. No console errors or warnings.

Migration tested from:

- No schema change in this slice.

Remaining risks:

- The queue and badge poll every five seconds; decision changes do not yet publish
  freshness signals. Expiry is not enforced by a worker, and a finished task's open
  requests are only superseded when someone next acts on them. Both are Phase 4
  deliverables in PHASES.md.
- Assignment is the initial assignee and delegation; claiming, due times, escalation
  and notes are slice 4.2. There are no notifications, and agents cannot open requests.
- Browser-level tests are not part of the CI gate; the keyboard and screen-reader
  behavior was reviewed by structure (labels, roles, tabs), not with assistive technology.
- The list shows the most recent 100 requests visible to the caller, with no paging.

Next executable slice: **4.2 — assignment, claiming, due times, escalation and notes**.
Add task claiming/assignment independent of remote state, due times and escalation
policy, and internal notes, scoped by the same grants. Do not begin notifications or
audit views in that slice.

## Phase 4 Slice 4.3 verified evidence

Date: 2026-10-05

Slice: **4.3 — worker-enforced expiry and live approval signals**

Changes:

- Added `DecisionService.sweep` and a decision loop in the embedded PGlite server and the
  external PostgreSQL worker (`A2A_DECISION_SWEEP_MS`, default 15 s). A pass expires
  overdue requests, supersedes open requests whose task has finished, and refreshes
  approved deliveries until the task outcome is final (watched for seven days).
  Changes re-check state under the request lock, so concurrent workers or a reviewer
  acting at the same time close a request once. The sweep has no principal and sends nothing.
- Every state change (open, revise, decide, expiry, supersession, delivery refresh) now
  audits and queues the existing content-free freshness signal in the same transaction;
  no-op passes publish nothing. Approval pages and the navigation badge re-query on the
  signal and keep their five-second poll as the missed-signal fallback.
- Added repository queries for requests on finished tasks and unsettled executions, ADR
  0015 addendum, and README, ARCHITECTURE and `.env.example` updates.

Verification commands and results:

- `npx tsc --noEmit`, `npm run lint` and `npm run build`: passed.
- The shared decision contract now also verifies expiry and supersession without any
  reviewer acting, two concurrent sweepers recording each closure once, a request on a
  task that finished within its deadline being superseded, no-op passes publishing no
  signal, unchanged deliveries not being rewritten, delivery refresh through WORKING to
  COMPLETED and then stopping, and the approved decision staying untouched by later task
  states. It passes on PGlite and PostgreSQL.
- Production HTTP verifies that the embedded worker expires a two-second request with
  nobody acting, that an `/api/tasks/events` stream receives a freshness signal when a
  request opens, that a late approval is refused and nothing reaches the agent, and that
  the expired request leaves the pending list.
- Scripted Chromium run (not committed): with a 300 ms sweep, an open review page changed
  from PENDING to EXPIRED and lost its action buttons with no reload; the earlier approval
  flows and the 390px mobile layout still passed, with no console errors or warnings.

Migration tested from:

- No schema change in this slice.

Remaining risks:

- Requesters and reviewers are not notified when a request expires, is superseded or is
  about to expire; that depends on the durable notification work.
- Opening a request for a task supersedes its other open requests, so two independent
  approvals cannot be open on one task. This matches the specified one-live-approval rule
  but is a product decision to revisit if multi-step approvals are wanted.
- The sweep scans in pages of 100 per pass; very large backlogs clear over several passes.
- The embedded worker needs the long-running Node server, as the other workers do.

**Slice 4.3 acceptance criteria are verified. Phase 4 remains active.**

Next executable slice: **4.2 — assignment, claiming, due times, escalation and notes**.

## Phase 4 Slice 4.2 verified evidence

Date: 2026-10-05

Slice: **4.2 — task ownership, due times, escalation and notes**

Changes:

- Added local task ownership independent of the remote task state (ADR 0016): claim,
  release, assign and reassign, due times, internal notes and escalation policies, with
  a migration for `task_assignments`, `task_assignment_events`, `task_notes` and
  `escalation_policies`. History and notes are immutable by database trigger.
- Anyone with an operate grant may take unowned work; only the owner or an administrator
  may release, reassign or change the due time of owned work. Assignees must be enabled
  operators or administrators with an operate grant for the agent/skill. Finished tasks
  cannot change ownership. Visibility follows the existing grants (404 without a read grant).
- Every change appends an event with strictly increasing per-task timestamps, an audit
  fact and a freshness signal in one transaction; repeating a true change writes nothing.
  Notes are idempotent per client note key and never reach the agent.
- The existing worker sweep now also escalates unfinished owned tasks whose due time passed,
  once per due time, to the administrator-configured target (agent rule over organization
  rule), recording a system event; an ineligible target leaves the owner in place and says so.
- UI: Ownership card (claim, release or take away, assign, due time, activity), Internal
  notes card and Escalation settings card (administrators), plus Mine, Overdue and
  Unassigned task filters and ownership/due chips on list rows. `GET /api/tasks` accepts
  the new filters and returns a per-row ownership summary. New routes under
  `/api/tasks/[id]/workflow` and `/api/escalation-policies`.
- Extracted the access/audit/freshness ports shared by approvals and workflow, and
  recorded the remaining work in PHASES.md.

Verification commands and results:

- `npx tsc --noEmit`, `npm run lint` (no warnings) and `npm run build`: passed. `npm run
  check`-equivalent: 30 unit files/91 tests (including new ownership-helper tests) and 14
  database files/32 tests on PGlite and PostgreSQL; schema check against a freshly migrated
  database showed no drift; all HTTP suites passed including the new workflow suite.
- The shared workflow contract verifies role, grant and cross-organization denial, a single
  winner for concurrent claims, idempotent repeats, owner/administrator rules, assignee
  eligibility, due-time validation and re-arming, idempotent and immutable notes and
  history, administrator-only policies, concurrent policy saves producing one rule, escalation
  by two concurrent sweepers exactly once per due time, finished tasks skipped, an
  ineligible target, agent policy overriding organization policy, disabled policies, queue
  views, summaries scoped to the organization, restart, and migration rollback/reapply.
- Production HTTP verifies the same flows through the real routes, the list filters and
  summaries, input validation, and a worker escalating overdue work to a second administrator
  exactly once with nobody acting.
- Scripted Chromium run (not committed): claim, assign, take away, due time, note (persisting
  across reload), Mine and Unassigned filters, saving an escalation rule in Settings, and an
  open task page switching to the escalation target with an ESCALATED badge without a reload.
  The 390px mobile layout still passed. No console errors or warnings. The run also exposed
  two controls both labelled "Assign to"; the ownership one is now "Assign task to".

Migration tested from:

- Clean PGlite and PostgreSQL through all thirteen migrations, with rollback/reapply and no
  schema drift. The migration only adds tables and triggers.

Remaining risks:

- No notifications yet: assignment and escalation are visible in the task page and queue
  views only. Approval requests keep their own assignee and `delegate`; they do not share
  task ownership.
- Escalation targets are individual reviewers (no teams or rotations) and escalate in one
  hop per due time. Queue views load assignment IDs before paging, which will not scale to
  very large queues; the Phase 5 inbox projection is the intended fix.
- Same-millisecond notes have no defined order; history rows are ordered per task.
- Escalation timing depends on the sweep interval (`A2A_DECISION_SWEEP_MS`, default 15 s).

**Slice 4.2 acceptance criteria are verified. Phase 4 remains active.**

Next executable slice: **4.4 — immutable workflow audit views** over decisions, ownership
events, notes and audit facts. Do not begin notifications in that slice.

## Phase 4 Slice 4.4 verified evidence

Date: 2026-10-05

Slice: **4.4 — immutable workflow audit views**

Changes:

- Added a read-only, newest-first audit timeline (ADR 0017) built by one query over the
  sources of truth: approval requests, revisions and decisions (exact content, revision
  digest, rationale, reviewer and delivery result), ownership events, note existence
  (never note text), expiry and supersession, and every other audit fact. Audit facts that a
  domain row already represents are not repeated.
- Immutability moved into the database: audit facts are append-only, and an approval
  request's identity and proposal can no longer be altered (only status, assignment,
  current revision and bookkeeping change). Migration `AuditImmutability` adds the triggers.
- Access: administrators read the organization trail; any member who can read a task reads
  that task's trail without identity or access facts (404 without a read grant); other
  organizations are unreachable. Reads are keyset-paged in a read-only transaction,
  filterable by task, group, actor and time range, bounded to 200 rows, and write nothing.
- `GET /api/audit` and an administrator CSV export (`/api/audit/export`, one bounded page
  with `X-Next-Cursor`, formula-neutralized cells, attachment and `nosniff`). No mutation
  routes exist for the trail.
- UI: an Audit page (administrators; task trails for readers) with group tabs, date range,
  paging, expandable exact facts and CSV export; an Audit card on every task; a link from
  each approval; an Audit item in navigation for administrators.

Verification commands and results:

- `npx tsc --noEmit`, `npm run lint` (no warnings) and `npm run build`: passed. Full
  `npm run check`-equivalent: 31 unit files/96 tests and 15 database files/34 tests on PGlite
  and PostgreSQL, schema check clean against a freshly migrated database, and all HTTP
  suites passed.
- The shared audit contract builds every kind of fact through the real services and verifies:
  administrators-only organization trail and per-task read rules; newest-first ordering with
  unique keys; that the trail alone names who decided what, when and why (actor, exact text,
  revision, digest, rationale, delivery, message ID); edit attribution; system-attributed
  expiry; ownership detail; note text absent from the trail; a cross-check that every audited
  decision and ownership action has its timeline entry and none is invented; all filters;
  cursor paging that equals the unpaged list; rejection of bad cursors, limits and ranges;
  reads that write nothing; database rejection of audit updates and deletes and of changes to
  an approval's title, expiry, requester or existence; formula-injection-safe CSV; restart; and
  migration rollback/reapply.
- Production HTTP verifies the same through real routes, including the edited approval's
  exact content and digest matching its revision, the worker's expiry as a system entry,
  paging equality, 400/404 handling, absent mutation methods, and the OIDC suite's role,
  grant and cross-organization denials for the trail and its export.
- Scripted Chromium run (not committed): opening the Audit page from navigation, expanding a
  decision to its exact content and rationale, group tabs, absence of note text, the CSV
  link, a task's Audit card and its full trail page, and a 390px layout, with no console
  errors. The run exposed a clipped date field on narrow screens, now fixed. Two scripted
  runs failed waiting for an approvals entry on a task page. The later one was reproduced
  (the first run after a rebuild) and is a defect in the throwaway script: its text locator
  matched three elements once the new Audit card had loaded and Playwright's strict mode
  rejected it, so it is not an application fault. The earlier failure predates the Audit
  card, was never reproduced and is unexplained; fourteen later runs passed.

Migration tested from:

- Clean PGlite and PostgreSQL through all fourteen migrations, with rollback/reapply and no
  schema drift. The migration only adds triggers.

Remaining risks:

- The timeline is computed per request with a union; very large organizations need an audit
  projection and export beyond one page. Reads and exports of the trail are not audited.
- Tamper evidence is database immutability, not cryptographic; retention needs a controlled
  maintenance path because ordinary deletes are blocked. Both are Phase 7 items.
- Entries for deleted agents or removed members show generic names ("A former member").

**Slice 4.4 acceptance criteria are verified. Phase 4 remains active.**

Next executable slice: **4.5 — durable notifications and one external channel**: per-user
notification and read state, delivery through the outbox behind adapters, a browser inbox
replacing the session-only alerts, and one external channel.

## Phase 4 Slice 4.5 and phase exit verified evidence

Date: 2026-10-05

Slice: **4.5 — durable notifications and one external channel**

Changes:

- Added durable per-person notifications (ADR 0018). Events are raised in the transaction that
  causes them: approval opened, revised, assigned or delegated, decided, expiring, expired and
  superseded; task assigned and escalated; and tasks entering input-required, auth-required,
  finished or failed during ingestion. A leased fan-out worker turns each event into one
  immutable notification and one recipient row per person, exactly once (the notification ID is
  the event's outbox ID), with bounded retries that stop without blocking other events.
- Recipients follow responsibility and access: the assignee, otherwise eligible reviewers;
  never whoever caused the event; the requester for outcomes and closures; always only people
  who can read the task's agent. Wording carries no proposal text, rationale or note body.
- Read state is a per-recipient mark that only its owner can set (database trigger enforces
  that nothing else changes). The inbox hides notifications about tasks a member can no longer
  read. `GET /api/notifications`, `POST /api/notifications/read`, an unread count in the
  navigation, and a rebuilt Notifications page replace the browser-derived, session-only alerts
  (their store and derivation are removed).
- One external channel behind a `NotificationChannel` port: a signed webhook (Slack-compatible
  `text`) for one organization, using the agent network policy. Each notification is posted at
  least once with delivery ID, timestamp and HMAC signature headers; delivery uses outbox
  retries with backoff and ends in a visible failed state; stored errors are fixed strings.
  An administrator card shows state, counts and last failure (host only) and sends a test.
- An expiring warning fires once per open request near its deadline (`expiry_warned_at`).
- Phase 4 follow-ups that do not block its exit criteria are listed in PHASES.md.

Verification commands and results:

- `npx tsc --noEmit`, `npm run lint` (no warnings) and `npm run build`: passed. Full quality
  gate: 32 unit files/99 tests and 16 database files/36 tests on PGlite and PostgreSQL, schema
  check clean against a freshly migrated database, and all HTTP suites including the new
  notifications suite.
- The shared notification contract verifies recipient rules for every event kind (including
  that actors, the unprivileged and other organizations are never told), absence of proposal
  text and rationale from notifications and webhook bodies, exactly-once fan-out on
  reprocessing, retry then permanent failure of a poisoned event without blocking others,
  expiring warnings once, personal read state (others' marks change nothing), keyset paging
  equal to the full list, access revocation hiding notifications, immutability triggers, a real
  HTTP receiver checking the signature, timestamp, delivery ID and one post per notification,
  retry with redacted errors and a bounded failed state, administrator-only status and test,
  configuration validation, restart, and migration rollback/reapply.
- Production HTTP verifies the same through real routes, including notifications created by the
  real ingestion path (input needed, finished), escalation and worker expiry, validation and
  paging, read marks, and the webhook's signature and content; the OIDC suite verifies
  authentication, per-member inboxes, administrator-only channel routes and origin checks.
- Scripted Chromium run (not committed): the inbox, unread badge, opening an item marking it
  read, marking all read with the badge clearing, read state surviving reload, the Unread tab,
  the channel card and test notification, and a 390px layout, with no console errors. The run
  hit the page's script policy when it tried string evaluation, so it polls with locators.
- Bugs found and fixed by the new tests: a fan-out hang on single-connection PGlite (a nested
  transaction), page-boundary duplicates in the inbox cursor, and test events whose aggregate
  ID was not a UUID.

Phase 4 exit criteria verified:

- The audit record alone identifies who decided exactly what and when (4.4: exact content,
  revision digest, rationale, reviewer, delivery; database-enforced immutability).
- Replayed, repeated or concurrent decisions do not execute twice (4.1: one command per
  decision, idempotency keys, locks; HTTP and both databases).
- Expired or superseded approvals cannot authorize anything (4.1/4.3: refusal on decide,
  worker expiry and supersession, final task states).
- Assigned input and approval work reaches the responsible user's durable queue (4.2 ownership
  and queue views with 4.5 notifications and read state).

Migration tested from:

- Clean PGlite and PostgreSQL through all fifteen migrations, with rollback/reapply and no
  schema drift. The migration adds two tables, a column and triggers.

Remaining risks:

- PostgreSQL verification used the sandbox's PostgreSQL 16, not the 18 service CI uses.
- The webhook is one destination per deployment for one organization; delivery is at least once.
  Unowned input-required work notifies up to 25 eligible reviewers, which can be noisy until
  per-person preferences exist (Phase 5). Notification retention is unlimited.
- The removed browser alerts also showed finished tasks and ready artifacts to everyone;
  finished tasks now notify owners only and artifact-ready notices are not produced.
- Browser-level tests are still manual scripts outside the CI gate.

**Slice 4.5 and every Phase 4 exit criterion are verified. Phase 4 is complete.**

Next executable slice: **Phase 5, 5.1 — unified authorized inbox over tasks and approvals**
(global inbox, folding the Approvals queue into it, with indexed queries). Do not begin Phase 5
without a continuation request.

## Known repository-state issue

The working application branch is ahead of the public default branch. Publishing
or merging it is release work and must be handled explicitly; it does not alter
the Phase 1 technical dependency order.

## Status update template

When completing a slice, replace this section with evidence in this form:

```text
Date:
Slice:
Changes:
Verification commands and results:
Migration tested from:
Remaining risks:
Next executable slice:
```
