import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { DatabaseAgentRegistry } from "./agent-registry";
import { createDatabaseOrm } from "./orm";
import type { DatabaseConfig } from "./config";
import { createPersistenceRepositories } from "./repositories";
import { createTaskObserver, withTaskQueries } from "../../runtime/task-persistence";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { TaskEntity, TaskEventEntity } from "./entities";
import { TaskQueryService } from "../../application/services/task-query";
import { ObserveTaskService, eventDigest } from "../../application/services/observe-task";

const date = "2026-10-03T00:00:00Z";
const started = { task: { id: "same-remote-id", contextId: "same-context", status: { state: "TASK_STATE_WORKING", timestamp: date } } };

async function contract(config: DatabaseConfig, directory: string) {
  let orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const registry = new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent.json"), environmentUrls: () => [] });
    const agent = await registry.add("https://one.example.test/card.json");
    const secondAgent = await registry.add("https://two.example.test/card.json");
    const store = new FilesystemArtifactStore(join(directory, "objects"));
    const observe = (agentId = agent.id, tenant = "") => createTaskObserver({
      agentId, tenant, sessionId: randomUUID(), requestId: randomUUID(),
      userMessage: { messageId: "user-1", role: "ROLE_USER", parts: [{ text: "Do durable work" }], referenceTaskIds: ["linked"] },
    }, { orm, store });
    const writer = observe();
    const first = await writer(started);
    const raced = await Promise.all([observe()(started), observe()(started)]);
    expect(raced.every((task) => task.localId === first.localId)).toBe(true);
    const acrossAgent = await observe(secondAgent.id)(started);
    const acrossTenant = await observe(agent.id, "tenant-b")(started);
    expect(new Set([first.localId, acrossAgent.localId, acrossTenant.localId]).size).toBe(3);
    const linked = await observe()({ task: { id: "linked", status: { state: "TASK_STATE_COMPLETED" } } });
    const chunk = { artifactUpdate: { taskId: "same-remote-id", artifact: { artifactId: "text", parts: [{ text: "ha", mediaType: "text/plain" }] }, append: true, lastChunk: false } };
    await writer(chunk); await writer(chunk);
    const replay = observe(); await replay(chunk); await replay(chunk);
    await writer({ artifactUpdate: { taskId: "same-remote-id", artifact: { artifactId: "text", parts: [{ text: "!" }] }, append: true, lastChunk: true } });
    const binaryEvent = { artifactUpdate: { taskId: "same-remote-id", artifact: { artifactId: "file", parts: [{ raw: "aGVsbG8=", mediaType: "application/octet-stream" }] }, lastChunk: true } };
    await writer(binaryEvent);
    await writer({ statusUpdate: { taskId: "same-remote-id", status: {
      state: "TASK_STATE_INPUT_REQUIRED", timestamp: "2026-10-03T00:00:02Z",
      message: { messageId: "question", role: "ROLE_AGENT", parts: [{ text: "Proceed?" }] },
    } } });
    const inputRequired = await withTaskQueries((query, organizationId) => query.detail(organizationId, first.localId), orm);
    expect(inputRequired?.messages.map((message) => message.id)).toEqual(["user-1", "question"]);
    expect(inputRequired?.messages[1].fromStatus).toBe(true);
    expect(inputRequired?.referenceLinks.linked).toBe(linked.localId);
    expect(inputRequired?.artifacts.find((artifact) => artifact.artifactId === "text")).toMatchObject({ parts: [{ value: "haha!" }], complete: true, updateCount: 3 });
    const file = inputRequired!.artifacts.find((artifact) => artifact.artifactId === "file")!;
    expect(file.parts[0].kind).toBe("url");
    const repositories = createPersistenceRepositories(orm.em.fork());
    const org = (await repositories.organizations.findBySlug("local"))!;
    const ledger = await repositories.taskEvents.findByTaskId(org.id, first.localId);
    expect(ledger).toHaveLength(7);
    expect(JSON.stringify(ledger)).not.toContain("aGVsbG8=");
    const binaryRow = ledger.find((event) => event.payloadDigest === eventDigest(binaryEvent))!;
    const archivedKey = (binaryRow.payloadJson as { originalEventObjectKey: string }).originalEventObjectKey;
    expect(JSON.parse(Buffer.from((await store.get(org.id, archivedKey.split("/")[1]))!).toString())).toEqual(binaryEvent);
    const digest = String(file.parts[0].value).split("/").at(-1)!;
    expect(Buffer.from((await store.get(org.id, digest))!).toString()).toBe("hello");
    const otherOrg = await repositories.organizations.getOrCreate({ id: randomUUID(), slug: "other", name: "Other", createdAt: new Date(), updatedAt: new Date() });
    const otherQuery = new TaskQueryService(repositories.tasks, repositories.agents);
    expect(await otherQuery.list(otherOrg.id)).toEqual([]);
    expect(await otherQuery.detail(otherOrg.id, first.localId)).toBeUndefined();
    expect(await otherQuery.detail(org.id, "same-remote-id")).toBeUndefined();
    expect(await store.get(otherOrg.id, digest)).toBeUndefined();
    expect(await withTaskQueries((query, organizationId) => query.list(organizationId, 50, 0, "needs-input"), orm)).toHaveLength(1);
    expect(await withTaskQueries((query, organizationId) => query.list(organizationId, 50, 0, "done"), orm)).toHaveLength(1);
    expect(await withTaskQueries((query, organizationId) => query.list(organizationId, 1, 1), orm)).toHaveLength(1);
    await writer({ statusUpdate: { taskId: "same-remote-id", status: { state: "TASK_STATE_COMPLETED", timestamp: "2026-10-03T00:00:03Z" } } });
    await writer({ statusUpdate: { taskId: "same-remote-id", status: { state: "TASK_STATE_WORKING", timestamp: "2026-10-03T00:00:01Z" } } });
    const completed = await withTaskQueries((query, organizationId) => query.detail(organizationId, first.localId), orm);
    expect(completed!.state).toBe("TASK_STATE_COMPLETED");
    // The two readers have separate request EntityManagers and no browser state.
    expect(await withTaskQueries((query, organizationId) => query.detail(organizationId, first.localId), orm)).toEqual(completed);
    expect(await withTaskQueries((query, organizationId) => query.list(organizationId), orm)).toHaveLength(4);
    const direct = { message: { messageId: "direct", contextId: "same-context", role: "ROLE_AGENT", parts: [{ text: "Direct answer" }] } };
    const directView = await observe()(direct);
    expect(await observe()(direct)).toMatchObject({ localId: directView.localId, kind: "message", state: "MESSAGE_ONLY" });
    expect((await repositories.tasks.findById(org.id, directView.localId))!.remoteTaskId).toBeNull();
    expect(await withTaskQueries((query, organizationId) => query.list(organizationId), orm)).toHaveLength(4);
    // Fail after ledger insertion: transaction rollback preserves both projection and ledger.
    const previousCount = await orm.em.fork().count(TaskEventEntity, { taskId: first.localId });
    await expect(orm.em.fork().transactional(async (transaction) => {
      const ports = createPersistenceRepositories(transaction);
      ports.tasks.saveProjection = async () => { throw new Error("Simulated projection failure"); };
      return new ObserveTaskService(ports.agents, ports.tasks, ports.taskEvents).observe({
        organizationId: org.id, agentId: agent.id, tenant: "", event: { statusUpdate: { taskId: "same-remote-id", status: { state: "TASK_STATE_FAILED" } } },
        source: "stream", sourceKey: "rollback", sessionId: "session", requestId: "request", directThreadId: randomUUID(),
      });
    })).rejects.toThrow("Simulated projection failure");
    expect(await orm.em.fork().count(TaskEventEntity, { taskId: first.localId })).toBe(previousCount);
    await orm.close(true);
    orm = await createDatabaseOrm(config);
    const recovered = await withTaskQueries((query, organizationId) => query.detail(organizationId, first.localId), orm);
    expect(recovered).toEqual(completed);
    expect(await orm.em.fork().count(TaskEntity, { agentId: agent.id })).toBe(4);
    // Repeated bytes in a genuinely new user turn are not mistaken for replay.
    const continuationEvent = { artifactUpdate: { taskId: "continuation", artifact: { artifactId: "tokens", parts: [{ text: "ha" }] }, append: true, lastChunk: false } };
    const turn = (messageId: string) => createTaskObserver({ agentId: agent.id, sessionId: randomUUID(), requestId: randomUUID(),
      userMessage: { messageId, role: "ROLE_USER", parts: [{ text: messageId }] },
    }, { orm, store });
    const continuation = await turn("turn-one")(continuationEvent);
    await turn("turn-two")(continuationEvent);
    const continued = await withTaskQueries((query, organizationId) => query.detail(organizationId, continuation.localId), orm);
    expect(continued!.artifacts[0].parts[0].value).toBe("haha");
    // User attachments also retain a reachable original protocol archive.
    const binaryInput = { messageId: "upload", role: "ROLE_USER", parts: [{ raw: "aGVsbG8=", mediaType: "application/octet-stream" }] };
    const upload = await createTaskObserver({ agentId: agent.id, sessionId: randomUUID(), requestId: randomUUID(), userMessage: binaryInput },
      { orm, store })({ task: { id: "upload-task", status: { state: "TASK_STATE_WORKING" } } });
    const uploadLedger = await createPersistenceRepositories(orm.em.fork()).taskEvents.findByTaskId(org.id, upload.localId);
    const uploadRow = uploadLedger.find((event) => event.payloadDigest === eventDigest(binaryInput))!;
    const uploadArchive = (uploadRow.payloadJson as { originalEventObjectKey: string }).originalEventObjectKey;
    expect(JSON.parse(Buffer.from((await store.get(org.id, uploadArchive.split("/")[1]))!).toString())).toEqual(binaryInput);
    expect(JSON.stringify(uploadLedger)).not.toContain("aGVsbG8=");
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally { await orm.close(true); }
}
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-tasks-"));
  try { await run(directory); } finally { await rm(directory, { force: true, recursive: true }); }
}
describe("TSK-002/005 REL-001 PGlite task observation", () => {
  it("recovers durable tasks, content and scoped identities with duplicate-safe observations", async () => {
    await temporary((directory) => contract({ profile: "pglite", dataDir: join(directory, "db") }, directory));
  });
});
const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
if (process.env.CI === "true" && !postgresUrl) throw new Error("CI must set A2A_TEST_POSTGRES_URL");
if (postgresUrl && !decodeURIComponent(new URL(postgresUrl).pathname).includes("test")) throw new Error("A2A_TEST_POSTGRES_URL must target a test database");
(postgresUrl ? describe : describe.skip)("TST-001 PostgreSQL task observation", () => {
  it("passes the same persistence, collision, replay, rollback and restart contract", async () => {
    await temporary((directory) => contract({ profile: "postgresql", url: postgresUrl! }, directory));
  });
});
