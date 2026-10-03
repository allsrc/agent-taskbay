import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DatabaseConfig } from "./config";
import type { JsonValue } from "../../domain/persistence-model";
import { createDatabaseOrm, withJobEntityManager } from "./orm";
import { createPersistenceRepositories } from "./repositories";
import { DatabaseAgentRegistry } from "./agent-registry";
import { OutboxMessageEntity, TaskEntity } from "./entities";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { DatabaseFreshness } from "../live/database-freshness";
import { InProcessFreshness } from "../live/in-process-freshness";
import { createTaskObserver, withTaskQueries } from "../../runtime/task-persistence";
import { createFreshnessDispatcher } from "../../runtime/freshness";
import { createProjectionRebuilder } from "../../runtime/projection-rebuild";
import { FreshnessDispatcher, TASK_FRESHNESS_TOPIC } from "../../application/services/task-freshness";

const snapshot = (id: string, state = "WORKING"): JsonValue => ({ task: { id, contextId: "context", status: { state: `TASK_STATE_${state}` } } });

async function contract(config: DatabaseConfig, directory: string) {
  let orm = await createDatabaseOrm(config);
  const store = new FilesystemArtifactStore(join(directory, "objects"));
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up({ to: "Migration20261003052730_VersionedTaskProjections" });
    const registry = new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    const agent = await registry.add("https://freshness.example.test/card");
    const ports = () => createPersistenceRepositories(orm.em.fork());
    const org = (await ports().organizations.findBySlug("local"))!;
    const retainedId = randomUUID();
    await orm.em.getConnection().execute(`insert into tasks (id, organization_id, agent_id, tenant, remote_task_id, kind, state, created_at, updated_at) values (?, ?, ?, '', 'retained', 'task', 'TASK_STATE_COMPLETED', now(), now())`, [retainedId, org.id, agent.id]);
    await orm.migrator.up();
    expect((await ports().tasks.findById(org.id, retainedId))!.remoteTaskId).toBe("retained");
    expect(await orm.migrator.checkSchema()).toBe(false);

    const observe = (event = snapshot("shared"), tenant = "") => createTaskObserver({
      organizationId: org.id, agentId: agent.id, tenant, sessionId: "session", requestId: "request",
    }, { orm, store })(event);
    const count = () => orm.em.fork().count(OutboxMessageEntity, { topic: TASK_FRESHNESS_TOPIC });
    const first = await observe();
    expect(await count()).toBe(1);
    await observe(); expect(await count()).toBe(1); // duplicate ingestion creates no signal.
    await expect(createTaskObserver({ agentId: agent.id, sessionId: "rollback", requestId: "rollback" }, {
      orm, store, onObserved: async () => { throw new Error("rollback"); },
    })(snapshot("rollback"))).rejects.toThrow("rollback");
    expect(await count()).toBe(1);
    expect(await orm.em.fork().count(TaskEntity, { remoteTaskId: "rollback" })).toBe(0);
    const signal = (await orm.em.fork().find(OutboxMessageEntity, { topic: TASK_FRESHNESS_TOPIC }))[0];
    expect(signal.payloadJson).toEqual({});
    expect(signal.aggregateId).toBe(first.localId);
    const local = new InProcessFreshness();
    const shared = new DatabaseFreshness(orm);
    const read = () => withTaskQueries((query) => query.detail(org.id, first.localId), orm);
    const before = await read();
    const publisher = config.profile === "pglite" ? local : shared;
    expect(await publisher.readToken(org.id)).toBe("");
    // Two publishers race for one row. Delivery happens after the projection commit.
    const dispatcher = () => createFreshnessDispatcher({ orm, publisher: { publish: async (organizationId) => {
      expect(await read()).toEqual(before);
      await publisher.publish(organizationId);
    } } });
    const race = await Promise.all([dispatcher().runOne(), dispatcher().runOne()]);
    expect(race.filter(Boolean)).toHaveLength(1);
    expect(await publisher.readToken(org.id)).not.toBe("");
    expect(await ports().outbox.findById(org.id, signal.id)).toMatchObject({ status: "processed", attempts: 1 });
    // Failed publication retains intent and safe retry state; the committed task remains readable.
    await observe(snapshot("shared", "INPUT_REQUIRED"));
    const fail = createFreshnessDispatcher({ orm, publisher: { publish: async () => { throw new Error("secret credential"); } } });
    expect(await fail.runOne()).toBe(true);
    const failed = (await orm.em.fork().find(OutboxMessageEntity, { topic: TASK_FRESHNESS_TOPIC, status: "pending" }))[0];
    expect(failed.lastError).toBe("Freshness publication failed; retry scheduled.");
    expect((await read())!.state).toBe("TASK_STATE_INPUT_REQUIRED");
    expect(await fail.runOne()).toBe(false); // backoff.
    await orm.em.fork().nativeUpdate(OutboxMessageEntity, { id: failed.id }, { availableAt: new Date(0) });
    // Simulate publication succeeding remotely but its acknowledgement being lost.
    const loss = createFreshnessDispatcher({ orm, publisher: { publish: async (organizationId) => {
      await shared.publish(organizationId); throw new Error("response lost");
    } } });
    expect(await loss.runOne()).toBe(true);
    const published = await shared.readToken(org.id);
    expect(published).not.toBe("");
    await orm.em.fork().nativeUpdate(OutboxMessageEntity, { id: failed.id }, { availableAt: new Date(0) });
    expect(await createFreshnessDispatcher({ orm, publisher: shared }).runOne()).toBe(true);
    expect(await shared.readToken(org.id)).not.toBe(published);
    expect((await read())!.messages).toEqual(before!.messages); // duplicate signal never mutates content.
    // Rebuild and direct Messages are also committed readable projection changes.
    await createProjectionRebuilder({ orm, store }).rebuild(org.id, first.localId);
    await observe({ message: { messageId: "direct", role: "ROLE_AGENT", parts: [{ text: "Answer" }] } });
    await observe(snapshot("shared"), "tenant-b");
    expect(await count()).toBe(5);
    await orm.em.fork().nativeDelete(OutboxMessageEntity, { topic: TASK_FRESHNESS_TOPIC, status: "processed" });
    // Expired ownership is safely republished after restart; late acknowledgement is fenced.
    const lease = await orm.em.fork().transactional((tx) => createPersistenceRepositories(tx).outbox.claim(
      TASK_FRESHNESS_TOPIC, "crashed", new Date(), new Date(Date.now() + 15_000)));
    expect(lease).toBeDefined();
    await orm.em.fork().nativeUpdate(OutboxMessageEntity, { id: lease!.message.id }, { leaseUntil: new Date(0) });
    await orm.close(true); orm = await createDatabaseOrm(config);
    const recoveredShared = new DatabaseFreshness(orm);
    expect(await recoveredShared.readToken(org.id)).not.toBe("");
    expect(await ports().outbox.finish(lease!.message.id, org.id, "crashed", new Date(),
      { status: "processed", availableAt: new Date(), processedAt: new Date(), lastError: null })).toBe(false);
    const recover = createFreshnessDispatcher({ orm, publisher: recoveredShared });
    while (await recover.runOne()) { /* Drain all committed intent with zero browsers. */ }
    expect(await orm.em.fork().count(OutboxMessageEntity, { topic: TASK_FRESHNESS_TOPIC, status: "processed" })).toBe(3);
    expect((await read())!.state).toBe("TASK_STATE_INPUT_REQUIRED");
    const other = await ports().organizations.getOrCreate({ id: randomUUID(), slug: "foreign", name: "Foreign", createdAt: new Date(), updatedAt: new Date() });
    expect(await recoveredShared.readToken(other.id)).toBe("");
    const token = await recoveredShared.readToken(org.id);
    await recoveredShared.publish(other.id);
    expect(await recoveredShared.readToken(org.id)).toBe(token);
    expect(await ports().outbox.findById(other.id, lease!.message.id)).toBeUndefined();
    // A publisher that completes after expiry cannot acknowledge a reclaimed row.
    await observe(snapshot("late"));
    let now = new Date();
    const late = new FreshnessDispatcher({ run: (work) => withJobEntityManager((em) => em.transactional((tx) =>
      work(createPersistenceRepositories(tx).outbox)), orm) }, { publish: async () => { now = new Date(now.getTime() + 16_000); } }, { now: () => now });
    await late.runOne();
    expect(await orm.em.fork().count(OutboxMessageEntity, { topic: TASK_FRESHNESS_TOPIC, status: "processing" })).toBe(1);
    await orm.em.fork().nativeUpdate(OutboxMessageEntity, { topic: TASK_FRESHNESS_TOPIC, status: "processing" }, { leaseUntil: new Date(0) });
    await recover.runOne();
    expect(await orm.em.fork().count(OutboxMessageEntity, { topic: TASK_FRESHNESS_TOPIC, status: "processing" })).toBe(0);
    await orm.migrator.down({ to: "Migration20261003052730_VersionedTaskProjections" });
    expect((await ports().tasks.findById(org.id, first.localId))!.state).toBe("TASK_STATE_INPUT_REQUIRED");
    await orm.migrator.up();
    expect(await recoveredShared.readToken(org.id)).toBe("");
    expect(await count()).toBe(0);
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally { await orm.close(true); }
}

async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-freshness-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("REL-002/SCL-001 PGlite freshness", () => {
  it("publishes committed intent with rollback, retry, duplicate, lease, scope and restart safety", async () => {
    await temporary((directory) => contract({ profile: "pglite", dataDir: join(directory, "db") }, directory));
  });
});
const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
if (process.env.CI === "true" && !postgresUrl) throw new Error("CI must set A2A_TEST_POSTGRES_URL");
if (postgresUrl && !decodeURIComponent(new URL(postgresUrl).pathname).includes("test")) throw new Error("A2A_TEST_POSTGRES_URL must target a test database");
(postgresUrl ? describe : describe.skip)("TST-001 PostgreSQL freshness", () => {
  it("passes the same durable freshness and shared publication contract", async () => {
    await temporary((directory) => contract({ profile: "postgresql", url: postgresUrl! }, directory));
  });
});
