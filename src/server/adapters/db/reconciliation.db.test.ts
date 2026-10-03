import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DatabaseConfig } from "./config";
import type { A2AReconciliationGateway } from "../../application/ports/reconciliation";
import { ListTasksUnsupported } from "../../application/ports/reconciliation";
import type { JsonValue } from "../../domain/persistence-model";
import { createDatabaseOrm } from "./orm";
import { createPersistenceRepositories } from "./repositories";
import { DatabaseAgentRegistry } from "./agent-registry";
import { SyncCursorEntity, TaskEventEntity, TaskEntity } from "./entities";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { createTaskObserver } from "../../runtime/task-persistence";
import { createReconciliationWorker } from "../../runtime/reconciliation";
import { acceptCommand } from "../../runtime/commands";

const snapshot = (id: string, state = "TASK_STATE_WORKING", extra: Record<string, JsonValue> = {}): JsonValue =>
  ({ task: { id, contextId: "context", status: { state }, ...extra } });

async function contract(config: DatabaseConfig, directory: string) {
  let orm = await createDatabaseOrm(config);
  const store = new FilesystemArtifactStore(join(directory, "objects"));
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const registry = new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    const agent = await registry.add("https://reconcile.example.test/card");
    const otherAgent = await registry.add("https://other.example.test/card");
    const ports = () => createPersistenceRepositories(orm.em.fork());
    const org = (await ports().organizations.findBySlug("local"))!;
    const observe = (id: string, tenant = "", selected = agent.id, event = snapshot(id)) => createTaskObserver({
      organizationId: org.id, agentId: selected, tenant, sessionId: randomUUID(), requestId: randomUUID(),
    }, { orm, store })(event);
    // Intent is atomic with ingestion, absent for direct Messages and rolled-back tasks.
    const first = await observe("shared");
    const second = await observe("shared", "tenant-b");
    const third = await observe("shared", "", otherAgent.id);
    await observe("direct", "", agent.id, { message: { messageId: "direct", parts: [{ text: "Answer" }] } });
    expect(await orm.em.fork().count(SyncCursorEntity, {})).toBe(6);
    await expect(createTaskObserver({ agentId: agent.id, sessionId: "rollback", requestId: "rollback" }, {
      orm, store, onObserved: async () => { throw new Error("rollback"); },
    })(snapshot("rollback"))).rejects.toThrow();
    expect(await orm.em.fork().count(TaskEntity, { remoteTaskId: "rollback" })).toBe(0);
    const foreignOrg = await ports().organizations.getOrCreate({ id: randomUUID(), slug: "foreign", name: "Foreign", createdAt: new Date(), updatedAt: new Date() });
    const persistedAgent = (await ports().agents.findById(org.id, agent.id))!;
    const foreignAgent = await ports().agents.insert({ ...persistedAgent, id: randomUUID(), organizationId: foreignOrg.id });
    const foreign = await createTaskObserver({ organizationId: foreignOrg.id, agentId: foreignAgent.id, tenant: "", sessionId: "foreign", requestId: "foreign" }, { orm, store })(snapshot("shared"));
    expect(await ports().syncCursors.find(org.id, foreignAgent.id, "", "")).toBeUndefined();
    expect(await ports().tasks.findById(org.id, foreign.localId)).toBeUndefined();
    const shutdown = new AbortController();
    const defer = async () => orm.em.fork().nativeUpdate(SyncCursorEntity, {}, { availableAt: new Date(Date.now() + 600_000) });
    const ready = async (resourceKey: string, tenant = "", agentId = agent.id) => {
      await defer();
      await orm.em.fork().nativeUpdate(SyncCursorEntity, { organizationId: org.id, agentId, tenant, resourceKey }, { availableAt: new Date(0) });
    };
    const worker = (gateway: A2AReconciliationGateway) => createReconciliationWorker({ orm, store, gateway });
    const noList = async () => { throw new ListTasksUnsupported(); };
    // Non-streaming GetTask recovers a missed prompt, messages and binary artifact.
    const prompt = snapshot("shared", "TASK_STATE_INPUT_REQUIRED", {
      history: [{ messageId: "question", role: "ROLE_AGENT", parts: [{ text: "Proceed?" }] }],
      artifacts: [{ artifactId: "file", parts: [{ raw: "aGVsbG8=", mediaType: "text/plain" }] }],
    });
    await ready(first.localId);
    await worker({ get: async (_agent, task) => { expect(task.tenant).toBe(""); return prompt; }, list: noList }).runOne("poll", shutdown.signal);
    const paused = (await ports().tasks.findById(org.id, first.localId))!;
    expect(paused.state).toBe("TASK_STATE_INPUT_REQUIRED");
    expect(paused.contentJson).toMatchObject({ messages: [{ id: "question" }], artifacts: [{ parts: [{ value: expect.stringMatching(/^\/api\/artifacts\//) }] }] });
    expect(await ports().syncCursors.find(org.id, agent.id, "", first.localId)).toMatchObject({ status: "pending", leaseOwner: null, lastSyncedAt: expect.any(Date) });
    const eventCount = await orm.em.fork().count(TaskEventEntity, { taskId: first.localId });
    await ready(first.localId);
    await worker({ get: async () => prompt, list: noList }).runOne("duplicate", shutdown.signal);
    expect(await orm.em.fork().count(TaskEventEntity, { taskId: first.localId })).toBe(eventCount);
    // Full list pages only update known scoped tasks; checkpoint survives owner restart.
    await ready("");
    await worker({ get: async () => snapshot("shared"), list: async (_agent, cursor) => {
      expect(cursor).toMatchObject({ organizationId: org.id, agentId: agent.id, tenant: "", pageToken: "" });
      return { tasks: [snapshot("foreign"), prompt], nextPageToken: "page-two" };
    } }).runOne("page-one", shutdown.signal);
    expect(await orm.em.fork().count(TaskEntity, { remoteTaskId: "foreign" })).toBe(0);
    expect((await ports().tasks.findById(org.id, second.localId))!.state).toBe("TASK_STATE_WORKING");
    expect((await ports().tasks.findById(org.id, third.localId))!.state).toBe("TASK_STATE_WORKING");
    expect(await ports().syncCursors.find(org.id, agent.id, "", "")).toMatchObject({ pageToken: "page-two" });
    await orm.close(true); orm = await createDatabaseOrm(config);
    const completed = snapshot("shared", "TASK_STATE_COMPLETED", { artifacts: [{ artifactId: "file", parts: [{ text: "Final" }] }] });
    await worker({ get: async () => snapshot("shared"), list: async (_agent, cursor) => {
      expect(cursor.pageToken).toBe("page-two"); return { tasks: [completed], nextPageToken: "" };
    } }).runOne("restarted-page", shutdown.signal);
    expect((await ports().tasks.findById(org.id, first.localId))!.state).toBe("TASK_STATE_COMPLETED");
    expect(await ports().syncCursors.find(org.id, agent.id, "", first.localId)).toMatchObject({ status: "stopped" });
    expect((await ports().tasks.findById(foreignOrg.id, foreign.localId))!.state).toBe("TASK_STATE_WORKING");
    // Foreign identity/context/tenant is rejected and remote errors are redacted.
    for (const event of [snapshot("wrong"), snapshot("shared", "TASK_STATE_COMPLETED", { contextId: "foreign" }),
      snapshot("shared", "TASK_STATE_COMPLETED", { tenant: "foreign" })]) {
      await ready(second.localId, "tenant-b");
      await worker({ get: async () => event, list: noList }).runOne(randomUUID(), shutdown.signal);
      expect((await ports().tasks.findById(org.id, second.localId))!.state).toBe("TASK_STATE_WORKING");
      expect(await ports().syncCursors.find(org.id, agent.id, "tenant-b", second.localId)).toMatchObject({ lastError: "Task reconciliation unavailable; read retry scheduled." });
    }
    // Unsupported list is durable and leaves polling operational.
    await ready("", "tenant-b");
    await worker({ get: async () => snapshot("shared"), list: noList }).runOne("unsupported", shutdown.signal);
    expect(await ports().syncCursors.find(org.id, agent.id, "tenant-b", "")).toMatchObject({ status: "unsupported" });
    await ready(second.localId, "tenant-b");
    await worker({ get: async () => { throw new Error("Bearer super-secret"); }, list: noList }).runOne("error", shutdown.signal);
    expect(JSON.stringify(await ports().syncCursors.find(org.id, agent.id, "tenant-b", second.localId))).not.toContain("super-secret");
    // A crash expires safely; a former owner cannot advance checkpoint or commit.
    await ready(second.localId, "tenant-b");
    const crash = await orm.em.fork().transactional((em) => createPersistenceRepositories(em).syncCursors.claim("crashed", new Date(), new Date(Date.now() + 15_000)));
    await orm.em.fork().nativeUpdate(SyncCursorEntity, { id: crash!.id }, { leaseUntil: new Date(0) });
    await orm.close(true); orm = await createDatabaseOrm(config);
    expect(await ports().syncCursors.renew(crash!, new Date(), new Date(Date.now() + 15_000))).toBe(false);
    await worker({ get: async () => snapshot("shared", "TASK_STATE_AUTH_REQUIRED"), list: noList }).runOne("recovered", shutdown.signal);
    expect((await ports().tasks.findById(org.id, second.localId))!.state).toBe("TASK_STATE_AUTH_REQUIRED");
    // Two concurrent workers only issue one read. A concurrent cancellation wins.
    await ready(third.localId, "", otherAgent.id);
    let release!: () => void; let opened!: () => void;
    const entered = new Promise<void>((resolve) => { opened = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const race = worker({ get: async () => { calls++; opened(); await hold; return snapshot("shared"); }, list: noList });
    const pending = race.runOne("one", shutdown.signal);
    await entered;
    expect(await race.runOne("two", shutdown.signal)).toBe(false);
    await observe("shared", "", otherAgent.id, snapshot("shared", "TASK_STATE_CANCELED"));
    release(); await pending;
    expect(calls).toBe(1);
    expect((await ports().tasks.findById(org.id, third.localId))!.state).toBe("TASK_STATE_CANCELED");
    // Lost lease before ingestion rolls back event/projection and doesn't checkpoint.
    const lost = await observe("lost");
    await ready(lost.localId);
    await worker({ get: async () => {
      await orm.em.fork().nativeUpdate(SyncCursorEntity, { taskId: lost.localId }, { leaseUntil: new Date(0) });
      return snapshot("lost", "TASK_STATE_COMPLETED");
    }, list: noList }).runOne("lost", shutdown.signal);
    expect((await ports().tasks.findById(org.id, lost.localId))!.state).toBe("TASK_STATE_WORKING");
    expect(await orm.em.fork().count(TaskEventEntity, { taskId: lost.localId })).toBe(1);
    // A failed page never advances its cursor; reprocessing is safe.
    const pageTask = await observe("page-task");
    await ready("");
    const failPage = worker({ get: async () => snapshot("page-task"), list: async () => {
      await orm.em.fork().nativeUpdate(SyncCursorEntity, { agentId: agent.id, tenant: "", resourceKey: "" }, { leaseUntil: new Date(0) });
      return { tasks: [snapshot("page-task", "TASK_STATE_COMPLETED")], nextPageToken: "must-not-advance" };
    } });
    await failPage.runOne("fail-page", shutdown.signal);
    expect((await ports().tasks.findById(org.id, pageTask.localId))!.state).toBe("TASK_STATE_WORKING");
    expect((await ports().syncCursors.find(org.id, agent.id, "", ""))!.pageToken).not.toBe("must-not-advance");
    // GetTask recovers after the page failure, without a new send.
    await ready(pageTask.localId);
    await worker({ get: async () => snapshot("page-task", "TASK_STATE_COMPLETED"), list: noList }).runOne("fallback", shutdown.signal);
    expect((await ports().tasks.findById(org.id, pageTask.localId))!.state).toBe("TASK_STATE_COMPLETED");
    // Old snapshots cannot regress message or artifact content either.
    const fresh = await observe("fresh", "", agent.id, snapshot("fresh", "TASK_STATE_INPUT_REQUIRED", {
      status: { state: "TASK_STATE_INPUT_REQUIRED", timestamp: "2026-10-03T04:00:02Z" },
      artifacts: [{ artifactId: "fresh-artifact", parts: [{ text: "Fresh" }] }],
    }));
    await ready(fresh.localId);
    await worker({ get: async () => snapshot("fresh", "TASK_STATE_WORKING", {
      status: { state: "TASK_STATE_WORKING", timestamp: "2026-10-03T04:00:01Z" },
      artifacts: [{ artifactId: "fresh-artifact", parts: [{ text: "Stale" }] }],
    }), list: noList }).runOne("old-snapshot", shutdown.signal);
    const preserved = (await ports().tasks.findById(org.id, fresh.localId))!;
    expect(preserved.state).toBe("TASK_STATE_INPUT_REQUIRED");
    expect(JSON.stringify(preserved.contentJson)).toContain("Fresh");
    expect(JSON.stringify(preserved.contentJson)).not.toContain("Stale");
    // Reconciliation does not resend or resolve an uncertain initial command.
    const command = await acceptCommand(agent.id, { text: "Unknown remote outcome" }, "uncertain", { orm, store });
    await ports().commands.update(org.id, command.id, { status: "uncertain", resultJson: null, lastError: "Unknown", updatedAt: new Date() });
    await ready("");
    await worker({ get: async () => snapshot("lost"), list: async () => ({ tasks: [snapshot("unknown-send-outcome")], nextPageToken: "" }) }).runOne("uncertain-read", shutdown.signal);
    expect((await ports().commands.findById(org.id, command.id))!.status).toBe("uncertain");
    expect(await orm.em.fork().count(TaskEntity, { remoteTaskId: "unknown-send-outcome" })).toBe(0);
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally { await orm.close(true); }
}
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-reconciliation-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("TSK-003 REL-001 REL-002 reconciliation on PGlite", () => {
  it("recovers missed updates, checkpoints pages, restarts and fences scoped reads", async () => {
    await temporary((directory) => contract({ profile: "pglite", dataDir: join(directory, "db") }, directory));
  });
});
const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
if (process.env.CI === "true" && !postgresUrl) throw new Error("CI must set A2A_TEST_POSTGRES_URL");
if (postgresUrl && !decodeURIComponent(new URL(postgresUrl).pathname).includes("test")) throw new Error("A2A_TEST_POSTGRES_URL must target a test database");
(postgresUrl ? describe : describe.skip)("TST-001 PostgreSQL reconciliation", () => {
  it("passes the same reconciliation contract", async () => {
    await temporary((directory) => contract({ profile: "postgresql", url: postgresUrl! }, directory));
  });
});
