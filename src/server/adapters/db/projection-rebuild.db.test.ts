import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DatabaseConfig } from "./config";
import type { ArtifactStore } from "../../application/ports/artifact-store";
import type { JsonValue } from "../../domain/persistence-model";
import { createDatabaseOrm } from "./orm";
import { createPersistenceRepositories } from "./repositories";
import { DatabaseAgentRegistry } from "./agent-registry";
import { TaskEntity, TaskEventEntity, MessageProjectionEntity, ArtifactProjectionEntity, TaskProjectionEntity } from "./entities";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { createTaskObserver, withTaskQueries } from "../../runtime/task-persistence";
import { createProjectionRebuilder } from "../../runtime/projection-rebuild";
import { eventDigest } from "../../application/services/event-identity";
import { externalizeBinary } from "../../application/services/protocol-archive";

const status = (id: string, state = "WORKING", timestamp?: string): JsonValue => ({ task: { id, contextId: "context", status: { state: `TASK_STATE_${state}`, ...(timestamp ? { timestamp } : {}) } } });
const artifact = (id: string, text: string, append = true, lastChunk = false): JsonValue => ({ artifactUpdate: { taskId: id, artifact: { artifactId: "tokens", parts: [{ text }] }, append, lastChunk } });

async function contract(config: DatabaseConfig, directory: string) {
  let orm = await createDatabaseOrm(config);
  const store = new FilesystemArtifactStore(join(directory, "objects"));
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    // Upgrade from the immediately previous schema with actual legacy content,
    // original binary archive and immutable ledger identity.
    await orm.migrator.up({ to: "Migration20261003045027_TaskReconciliation" });
    const registry = new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    const agent = await registry.add("https://projection.example.test/card");
    const org = (await createPersistenceRepositories(orm.em.fork()).organizations.findBySlug("local"))!;
    const legacyId = randomUUID();
    const raw: JsonValue = { task: { id: "legacy", contextId: "context", status: { state: "TASK_STATE_INPUT_REQUIRED", timestamp: "2026-10-03T00:00:00Z",
      message: { messageId: "question", role: "ROLE_AGENT", parts: [{ text: "Continue?" }] } }, artifacts: [{ artifactId: "file", parts: [{ raw: "aGVsbG8=", mediaType: "text/plain" }] }] } };
    const safe = await externalizeBinary(raw, org.id, store);
    const legacyView = { localId: legacyId, taskId: "legacy", agentId: agent.id, agentName: "Agent", tenant: "", state: "TASK_STATE_INPUT_REQUIRED", kind: "task", createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z", messages: [], artifacts: [], referenceLinks: {} };
    await orm.em.getConnection().execute(`insert into tasks (id, organization_id, agent_id, tenant, remote_task_id, remote_context_id, kind, state, content_json, created_at, updated_at) values (?, ?, ?, '', 'legacy', 'context', 'task', 'TASK_STATE_INPUT_REQUIRED', ?, ?, ?)`,
      [legacyId, org.id, agent.id, JSON.stringify(legacyView), new Date(legacyView.createdAt), new Date(legacyView.updatedAt)]);
    await orm.em.getConnection().execute(`insert into task_events (id, organization_id, agent_id, task_id, source, event_kind, received_at, remote_timestamp, source_key, payload_digest, payload_json, projection_version) values (?, ?, ?, ?, 'stream', 'task', ?, ?, 'legacy', ?, ?, 1)`,
      [randomUUID(), org.id, agent.id, legacyId, new Date(legacyView.createdAt), new Date(legacyView.createdAt), eventDigest(raw), JSON.stringify(safe)]);
    await orm.migrator.up();
    const ports = () => createPersistenceRepositories(orm.em.fork());
    // Operational revision changes on rebuild; deterministic content excludes it.
    const read = async (id: string = legacyId, organizationId: string = org.id) => {
      const view = await withTaskQueries((queries) => queries.detail(organizationId, id), orm);
      if (view) delete view.version;
      return view;
    };
    expect(await read()).toMatchObject({ messages: [], artifacts: [] });
    expect(await orm.em.fork().count(TaskProjectionEntity, {})).toBe(0);
    const rebuilder = () => createProjectionRebuilder({ orm, store });
    const ledgerBefore = await ports().taskEvents.findByTaskId(org.id, legacyId);
    const rebuilt = await rebuilder().rebuild(org.id, legacyId);
    expect(rebuilt).toMatchObject({ state: "TASK_STATE_INPUT_REQUIRED", messages: [{ id: "question", fromStatus: true }], artifacts: [{ artifactId: "file", parts: [{ kind: "url" }] }] });
    expect(await ports().tasks.findById(org.id, legacyId)).toMatchObject({ projectionVersion: 2 });
    const projectedIdentity = (await orm.em.fork().find(MessageProjectionEntity, { taskId: legacyId }))[0].id;
    expect(await rebuilder().rebuild(org.id, legacyId)).toEqual(rebuilt);
    expect((await orm.em.fork().find(MessageProjectionEntity, { taskId: legacyId }))[0].id).toBe(projectedIdentity);
    expect(await ports().taskEvents.findByTaskId(org.id, legacyId)).toEqual(ledgerBefore);
    const fileDigest = String(rebuilt.artifacts[0].parts[0].value).split("/").at(-1)!;
    expect(Buffer.from((await store.get(org.id, fileDigest))!).toString()).toBe("hello");
    expect(JSON.stringify(await orm.em.fork().find(ArtifactProjectionEntity, {}))).not.toContain("aGVsbG8=");
    // All content projections are repairable; transitional JSON has no authority.
    await orm.em.fork().nativeUpdate(TaskEntity, { id: legacyId }, { contentJson: { state: "WRONG" } });
    await orm.em.fork().nativeUpdate(MessageProjectionEntity, { taskId: legacyId }, { contentJson: { id: "corrupted" } });
    expect(await rebuilder().rebuild(org.id, legacyId)).toEqual(rebuilt);
    expect(await read()).toEqual(rebuilt);
    await orm.em.fork().nativeDelete(TaskProjectionEntity, { taskId: legacyId });
    await orm.em.fork().nativeDelete(ArtifactProjectionEntity, { taskId: legacyId });
    expect(await rebuilder().rebuild(org.id, legacyId)).toEqual(rebuilt);
    expect(await read()).toEqual(rebuilt);
    // Read remains available throughout slow archive loading. A concurrent
    // ingestion forces recapture and prevents stale activation.
    let opened!: () => void; let release!: () => void;
    const entered = new Promise<void>((resolve) => { opened = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    let waits = 0;
    const slowStore: ArtifactStore = { put: (organization, bytes) => store.put(organization, bytes), get: async (organization, digest) => {
      if (digest === safe.originalEventObjectKey!.split("/")[1] && waits++ === 0) { opened(); await hold; }
      return store.get(organization, digest);
    } };
    const pending = createProjectionRebuilder({ orm, store: slowStore }).rebuild(org.id, legacyId);
    await entered;
    expect(await read()).toEqual(rebuilt);
    await createTaskObserver({ agentId: agent.id, sessionId: "new", requestId: "new" }, { orm, store })(status("legacy", "COMPLETED", "2026-10-03T00:00:02Z"));
    release();
    expect(await pending).toMatchObject({ state: "TASK_STATE_COMPLETED" });
    const beforeFailure = await read();
    const badStore: ArtifactStore = { put: (organization, bytes) => store.put(organization, bytes), get: async () => undefined };
    await expect(createProjectionRebuilder({ orm, store: badStore }).rebuild(org.id, legacyId)).rejects.toThrow("missing or corrupt");
    expect(await read()).toEqual(beforeFailure);
    const corruptStore: ArtifactStore = { ...badStore, get: async () => Buffer.from("corrupt") };
    await expect(createProjectionRebuilder({ orm, store: corruptStore }).rebuild(org.id, legacyId)).rejects.toThrow("missing or corrupt");
    // Cross-source duplicate appends, distinct same-byte occurrences, stale
    // snapshots and authoritative replacement assembly.
    const observe = (id: string, source: "stream" | "webhook" | "reconcile" = "stream", tenant = "", selected = agent.id) => createTaskObserver({
      agentId: selected, tenant, source, sessionId: randomUUID(), requestId: randomUUID(),
    }, { orm, store });
    const writer = observe("shared");
    const shared = await writer(status("shared", "WORKING", "2026-10-03T00:00:01Z"));
    await writer(artifact("shared", "ha")); await writer(artifact("shared", "ha"));
    const push = observe("shared", "webhook"); await push(artifact("shared", "ha")); await push(artifact("shared", "ha"));
    await writer(artifact("shared", "!", true, true));
    expect((await read(shared.localId))!.artifacts[0]).toMatchObject({ parts: [{ value: "haha!" }], updateCount: 3 });
    await observe("shared", "reconcile")({ task: { id: "shared", contextId: "context", status: { state: "TASK_STATE_COMPLETED", timestamp: "2026-10-03T00:00:03Z" },
      artifacts: [{ artifactId: "tokens", parts: [{ text: "Corrected" }] }], history: [{ role: "ROLE_AGENT", parts: [{ text: "Done" }] }] } });
    await writer({ statusUpdate: { taskId: "shared", status: { state: "TASK_STATE_COMPLETED", timestamp: "2026-10-03T00:00:03Z", message: { role: "ROLE_AGENT", parts: [{ text: "Done" }] } } } });
    await writer({ task: { id: "shared", status: { state: "TASK_STATE_WORKING", timestamp: "2026-10-03T00:00:02Z" }, artifacts: [{ artifactId: "tokens", parts: [{ text: "Stale" }] }] } });
    const final = await read(shared.localId);
    expect(final).toMatchObject({ state: "TASK_STATE_COMPLETED", messages: [{ parts: [{ value: "Done" }] }], artifacts: [{ parts: [{ value: "Corrected" }] }] });
    expect(await rebuilder().rebuild(org.id, shared.localId)).toEqual(final);
    // Agent/tenant/org collisions and direct Message rebuild preserve identity.
    const other = await registry.add("https://other-projection.example.test/card");
    const tenant = await observe("shared", "stream", "tenant-b")(status("shared"));
    const agentCollision = await observe("shared", "stream", "", other.id)(status("shared"));
    const foreignOrg = await ports().organizations.getOrCreate({ id: randomUUID(), slug: "foreign", name: "Foreign", createdAt: new Date(), updatedAt: new Date() });
    await expect(rebuilder().rebuild(foreignOrg.id, shared.localId)).rejects.toThrow("Unknown task");
    expect(await read(shared.localId, foreignOrg.id)).toBeUndefined();
    const templateAgent = (await ports().agents.findById(org.id, agent.id))!;
    const foreignAgent = await ports().agents.insert({ ...templateAgent, id: randomUUID(), organizationId: foreignOrg.id });
    const foreignTask = await createTaskObserver({ organizationId: foreignOrg.id, agentId: foreignAgent.id,
      sessionId: "foreign", requestId: "foreign" }, { orm, store })(status("shared"));
    expect(await rebuilder().rebuild(foreignOrg.id, foreignTask.localId)).toMatchObject({ state: "TASK_STATE_WORKING", agentId: foreignAgent.id });
    expect(await read(shared.localId)).toEqual(final);
    expect(await rebuilder().rebuild(org.id, tenant.localId)).toMatchObject({ tenant: "tenant-b", state: "TASK_STATE_WORKING" });
    expect(await rebuilder().rebuild(org.id, agentCollision.localId)).toMatchObject({ agentId: other.id, state: "TASK_STATE_WORKING" });
    const direct = await observe("direct")({ message: { messageId: "direct", role: "ROLE_AGENT", parts: [{ text: "Answer" }] } });
    expect(await rebuilder().rebuild(org.id, direct.localId)).toMatchObject({ kind: "message", state: "MESSAGE_ONLY", messages: [{ id: "direct" }] });
    const base = (await ports().tasks.findById(org.id, legacyId, false))!;
    const noEvents = await ports().tasks.insert({ ...base, id: randomUUID(), remoteTaskId: "no-events", projectionVersion: 1, contentJson: {} });
    await expect(rebuilder().rebuild(org.id, noEvents.id)).rejects.toThrow("without retained protocol events");
    expect(await ports().tasks.findById(org.id, noEvents.id)).toMatchObject({ projectionVersion: 1 });
    // Upload archive restoration also handles the original unwrapped Message.
    const upload = await createTaskObserver({ agentId: agent.id, sessionId: "upload", requestId: "upload",
      userMessage: { messageId: "upload", role: "ROLE_USER", parts: [{ raw: "aGVsbG8=" }] },
    }, { orm, store })(status("upload"));
    expect(await rebuilder().rebuild(org.id, upload.localId)).toEqual(await read(upload.localId));
    // A failure during replacement rolls back normalized rows and active pointer.
    const beforeRollback = await read(shared.localId);
    await expect(orm.em.fork().transactional(async (tx) => {
      const task = (await createPersistenceRepositories(tx).tasks.findById(org.id, shared.localId))!;
      await createPersistenceRepositories(tx).tasks.saveProjection({ ...task, contentJson: { ...final, messages: [] } as unknown as JsonValue });
      throw new Error("interrupted activation");
    })).rejects.toThrow("interrupted activation");
    expect(await read(shared.localId)).toEqual(beforeRollback);
    expect(await orm.em.fork().count(TaskEventEntity, { taskId: shared.localId })).toBeGreaterThan(0);
    // Rollback exports the active generation, then re-upgrade retains readable
    // legacy state until an explicit rebuild switches back to version 2.
    await orm.migrator.down({ to: "Migration20261003045027_TaskReconciliation" });
    const legacyExport = await orm.em.getConnection().execute(`select content_json from tasks where id = ?`, [shared.localId]);
    expect(legacyExport[0].content_json).toEqual(final);
    await orm.migrator.up();
    expect(await read(shared.localId)).toEqual(final);
    expect(await rebuilder().rebuild(org.id, shared.localId)).toEqual(final);
    await orm.close(true); orm = await createDatabaseOrm(config);
    expect(await read(shared.localId)).toEqual(final);
    expect(await rebuilder().rebuild(org.id, shared.localId)).toEqual(final);
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally { await orm.close(true); }
}
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-projections-"));
  try { await run(directory); } finally { await rm(directory, { force: true, recursive: true }); }
}
describe("REL-001/003 TSK-002 PGlite projection rebuild", () => {
  it("rebuilds deterministically with online reads, archive integrity, scope and restart", async () => {
    await temporary((directory) => contract({ profile: "pglite", dataDir: join(directory, "db") }, directory));
  });
});
const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
if (process.env.CI === "true" && !postgresUrl) throw new Error("CI must set A2A_TEST_POSTGRES_URL");
if (postgresUrl && !decodeURIComponent(new URL(postgresUrl).pathname).includes("test")) throw new Error("A2A_TEST_POSTGRES_URL must target a test database");
(postgresUrl ? describe : describe.skip)("TST-001 PostgreSQL projection rebuild", () => {
  it("passes the same online rebuild, concurrency, archive, migration and scope contract", async () => {
    await temporary((directory) => contract({ profile: "postgresql", url: postgresUrl! }, directory));
  });
});
