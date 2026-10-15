import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabaseOrm } from "./orm";
import type { DatabaseConfig } from "./config";
import { createPersistenceRepositories } from "./repositories";
import { DatabaseAgentRegistry } from "./agent-registry";
import { provisionIdentity } from "./identity-repository";
import { OutboxMessageEntity, SecurityAuditEntity, SubscriptionEntity, SyncCursorEntity, TaskEntity } from "./entities";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { createReconciliationWorker } from "../../runtime/reconciliation";
import { changeAgentSettings } from "../../runtime/agent-settings";
import { ensureAutomaticDiscoveryCursors } from "../../runtime/discovery-cursors";
import { ListTasksUnsupported, type A2AReconciliationGateway, type ListOptions } from "../../application/ports/reconciliation";
import { NOTIFICATION_TOPIC } from "../../application/ports/notifications";
import { AGENT_LIMIT, FIRST_SWEEP_LIMIT, SWEEP_LIMIT } from "../../application/services/discover-tasks";
import type { JsonValue } from "../../domain/persistence-model";

afterEach(() => { delete process.env.A2A_TASK_DISCOVERY; });

const DAY = 86_400_000;
const entry = (id: string, state: string, ageMs = 0, extra: Record<string, unknown> = {}): JsonValue => ({ task: { id, contextId: `ctx-${id}`, status: { state: `TASK_STATE_${state}`, timestamp: new Date(Date.now() - ageMs).toISOString() }, ...extra } }) as JsonValue;

/** An agent that lists whatever it is given, a page at a time, and records how it was asked. */
function fakeAgent() {
  const tasks = new Map<string, JsonValue>();
  const asked: Array<{ tenant: string; pageToken: string; options?: ListOptions }> = [];
  let unsupported = false;
  const gateway: A2AReconciliationGateway = {
    async get(_agent, task) { return tasks.get(task.remoteTaskId!) ?? entry(task.remoteTaskId!, "WORKING"); },
    async list(_agent, cursor, _signal, options) {
      asked.push({ tenant: cursor.tenant, pageToken: cursor.pageToken, options });
      if (unsupported) throw new ListTasksUnsupported();
      const all = [...tasks.values()].filter((event) => (event as { task: { tenant?: string } }).task.tenant === undefined || (event as { task: { tenant?: string } }).task.tenant === cursor.tenant);
      const offset = Number(cursor.pageToken || 0);
      return { tasks: all.slice(offset, offset + 100), nextPageToken: offset + 100 < all.length ? String(offset + 100) : "" };
    },
  };
  return { gateway, tasks, asked, setUnsupported: (value: boolean) => { unsupported = value; } };
}

async function contract(config: DatabaseConfig, directory: string) {
  const orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const registry = new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    const agent = await registry.add("https://agent.test/card");
    const org = (await createPersistenceRepositories(orm.em.fork()).organizations.findBySlug("local"))!;
    const admin = await provisionIdentity(orm.em.fork(), { issuer: "https://idp.test", subject: "admin", organizationId: org.id, displayName: "admin", role: "admin" });
    const store = new FilesystemArtifactStore(join(directory, "artifacts"));
    const remote = fakeAgent();
    const worker = () => createReconciliationWorker({ orm, store, gateway: remote.gateway });
    const shutdown = new AbortController();
    // One full sweep of the list cursors, however many pages it takes, as the worker loop would do.
    const sweep = async () => {
      for (const cursor of await orm.em.fork().find(SyncCursorEntity, { resourceKey: "" })) {
        for (let page = 0; page < 20; page++) {
          await orm.em.fork().nativeUpdate(SyncCursorEntity, { id: cursor.id }, { availableAt: new Date(0) });
          if (!await worker().runOne(`w-${randomUUID()}`, shutdown.signal)) break;
          if ((await orm.em.fork().findOneOrFail(SyncCursorEntity, { id: cursor.id })).pageToken === "") break;
        }
      }
    };
    const discovered = () => orm.em.fork().count(TaskEntity, { origin: "discovered" });
    const audits = async (action: string) => orm.em.fork().count(SecurityAuditEntity, { action, targetId: agent.id });
    const notifications = async () => (await orm.em.fork().find(OutboxMessageEntity, { topic: NOTIFICATION_TOPIC })).length;

    // Browse only (the default): the sweep never stores anything it did not already know.
    remote.tasks.set("a", entry("a", "WORKING"));
    await orm.em.fork().transactional((em) => createPersistenceRepositories(em).syncCursors.startDiscovery(org.id, agent.id, [""], new Date(), false));
    await sweep();
    expect(await discovered()).toBe(0);
    expect(remote.asked.at(-1)?.options).toBeUndefined();

    // Switch automatic discovery on: the worker finds what the agent has, within the history window.
    process.env.A2A_TASK_DISCOVERY = "auto";
    await changeAgentSettings(admin, agent.id, { taskDiscovery: "auto" }, orm);
    remote.tasks.clear(); remote.asked.length = 0;
    remote.tasks.set("work", entry("work", "WORKING", 60_000));
    remote.tasks.set("ask", entry("ask", "INPUT_REQUIRED", 60_000));
    remote.tasks.set("done-recent", entry("done-recent", "COMPLETED", DAY));
    remote.tasks.set("done-old", entry("done-old", "COMPLETED", 30 * DAY));
    remote.tasks.set("foreign-tenant", entry("foreign-tenant", "WORKING", 0, { tenant: "someone-else" }));
    await sweep();
    const stored = await orm.em.fork().find(TaskEntity, { origin: "discovered" });
    expect(stored.map((task) => task.remoteTaskId).sort()).toEqual(["ask", "done-recent", "work"]);
    expect(stored.every((task) => task.trackedByUserId === null && task.skillId === null && task.ownerUserId === null)).toBe(true);
    expect(remote.asked[0].options).toMatchObject({ statusTimestampAfter: null, historyLength: 20 });
    // Working and waiting tasks are followed; a finished one is not; the one waiting on a person notifies once.
    const subscription = async (id: string) => (await orm.em.fork().findOneOrFail(SubscriptionEntity, { taskId: stored.find((task) => task.remoteTaskId === id)!.id })).status;
    expect(await subscription("work")).toBe("pending");
    expect(await subscription("done-recent")).toBe("stopped");
    expect(await notifications()).toBe(1);
    expect(await audits("task.discovery.found")).toBe(1);

    // The next sweep asks only for what changed, finds nothing new and writes nothing.
    await sweep();
    expect(remote.asked.at(-1)?.options?.statusTimestampAfter).toBeInstanceOf(Date);
    expect(await discovered()).toBe(3);
    expect(await audits("task.discovery.found")).toBe(1);
    expect(await notifications()).toBe(1);
    // A task already stored, even a finished one, is refreshed through the normal path and never counted as new.
    remote.tasks.set("work", entry("work", "COMPLETED", 0));
    await orm.em.fork().nativeUpdate(SyncCursorEntity, { resourceKey: "" }, { lastFullSweepAt: new Date(0) });
    await sweep();
    expect((await orm.em.fork().findOneOrFail(TaskEntity, { remoteTaskId: "work" })).state).toBe("TASK_STATE_COMPLETED");
    expect(await discovered()).toBe(3);

    // Turning it off (or lowering the cap) stops discovery at once; known tasks still refresh.
    remote.tasks.set("late", entry("late", "WORKING"));
    process.env.A2A_TASK_DISCOVERY = "browse";
    remote.asked.length = 0;
    await sweep();
    expect(await discovered()).toBe(3);
    expect(remote.asked.at(-1)?.options).toBeUndefined();
    process.env.A2A_TASK_DISCOVERY = "auto";
    await sweep();
    expect(await discovered()).toBe(4);

    // Leases: two workers over one cursor never both take it, so nothing is stored twice.
    remote.tasks.set("race", entry("race", "WORKING"));
    await orm.em.fork().nativeUpdate(SyncCursorEntity, { resourceKey: { $ne: "" } }, { availableAt: new Date(Date.now() + 600_000) });
    await orm.em.fork().nativeUpdate(SyncCursorEntity, { resourceKey: "" }, { availableAt: new Date(0), status: "pending", leaseOwner: null, leaseUntil: null });
    const taken = await Promise.all([worker().runOne("racer-1", shutdown.signal), worker().runOne("racer-2", shutdown.signal)]);
    expect(taken.filter(Boolean)).toHaveLength(1);
    expect(await orm.em.fork().count(TaskEntity, { remoteTaskId: "race" })).toBe(1);

    // Hostile lists store nothing wrong and do not stop the worker.
    remote.tasks.set("bad-1", { task: { id: "bad-1", status: { state: "TASK_STATE_NOPE" } } } as JsonValue);
    remote.tasks.set("bad-2", { task: { id: "", status: { state: "TASK_STATE_WORKING" } } } as JsonValue);
    remote.tasks.set("bad-3", { message: { messageId: "m" } } as JsonValue);
    const before = await orm.em.fork().count(TaskEntity, {});
    await sweep();
    expect(await orm.em.fork().count(TaskEntity, {})).toBe(before);

    // An agent that cannot list tasks is marked, and the worker carries on.
    remote.setUnsupported(true);
    await sweep();
    expect((await orm.em.fork().findOneOrFail(SyncCursorEntity, { agentId: agent.id, resourceKey: "", tenant: "" })).status).toBe("unsupported");
    remote.setUnsupported(false);

    // The worker prepares cursors for agents already in automatic mode when it starts, one per tenant of the card and of stored tasks.
    await orm.em.fork().nativeDelete(SyncCursorEntity, { resourceKey: "", tenant: "" });
    await ensureAutomaticDiscoveryCursors(orm);
    expect(await orm.em.fork().count(SyncCursorEntity, { agentId: agent.id, resourceKey: "", tenant: "" })).toBe(1);
  } finally { await orm.close(true); }
}

// Limits are checked against a separate agent so the first sweep, the later sweeps and the lifetime limit start clean.
async function limits(config: DatabaseConfig, directory: string) {
  const orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    process.env.A2A_TASK_DISCOVERY = "auto";
    const registry = new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    const agent = await registry.add("https://big.test/card");
    const org = (await createPersistenceRepositories(orm.em.fork()).organizations.findBySlug("local"))!;
    const admin = await provisionIdentity(orm.em.fork(), { issuer: "https://idp.test", subject: "admin", organizationId: org.id, displayName: "admin", role: "admin" });
    await changeAgentSettings(admin, agent.id, { taskDiscovery: "auto" }, orm);
    const store = new FilesystemArtifactStore(join(directory, "artifacts"));
    const remote = fakeAgent();
    for (let index = 0; index < 700; index++) remote.tasks.set(`t${index}`, entry(`t${index}`, "WORKING", index));
    const shutdown = new AbortController();
    const sweep = async () => {
      await orm.em.fork().nativeUpdate(SyncCursorEntity, { resourceKey: "" }, { availableAt: new Date(0) });
      for (let page = 0; page < 20; page++) {
        const ran = await createReconciliationWorker({ orm, store, gateway: remote.gateway }).runOne("limits", shutdown.signal);
        if (!ran) break;
        await orm.em.fork().nativeUpdate(SyncCursorEntity, { resourceKey: "" }, { availableAt: new Date(0) });
        if ((await orm.em.fork().findOneOrFail(SyncCursorEntity, { resourceKey: "", agentId: agent.id })).pageToken === "") break;
      }
    };
    const count = () => orm.em.fork().count(TaskEntity, { origin: "discovered" });
    await sweep();
    expect(await count()).toBe(FIRST_SWEEP_LIMIT);
    await sweep();
    expect(await count()).toBe(FIRST_SWEEP_LIMIT + SWEEP_LIMIT);
    // At the lifetime limit discovery pauses itself, says why, and stops asking for new work.
    const em = orm.em.fork();
    const have = await em.count(TaskEntity, { origin: "discovered" });
    const rows = Array.from({ length: AGENT_LIMIT - have }, (_, index) => ({ id: randomUUID(), organizationId: org.id, agentId: agent.id, tenant: "", remoteTaskId: `fill-${index}`, remoteContextId: null,
      kind: "task", state: "TASK_STATE_COMPLETED", title: null, origin: "discovered", discoveredAt: new Date(), createdAt: new Date(), updatedAt: new Date(), version: 1 }));
    await em.insertMany(TaskEntity, rows as never);
    remote.tasks.set("one-more", entry("one-more", "WORKING"));
    await sweep();
    const paused = await createPersistenceRepositories(orm.em.fork()).agents.findById(org.id, agent.id);
    expect(paused!.taskDiscoveryPausedReason).toBe("Reached the limit of 5,000 discovered tasks.");
    expect(await orm.em.fork().count(TaskEntity, { remoteTaskId: "one-more" })).toBe(0);
    expect(await orm.em.fork().count(SecurityAuditEntity, { action: "task.discovery.paused", targetId: agent.id })).toBe(1);
    remote.asked.length = 0;
    await sweep();
    expect(remote.asked.at(-1)?.options).toBeUndefined();
  } finally { await orm.close(true); }
}

async function temporary(config: (directory: string) => DatabaseConfig, run: typeof contract) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-auto-discovery-"));
  try { await run(config(directory), directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("automatic discovery (PGlite)", () => {
  it("finds, follows and limits tasks started elsewhere", () => temporary((dir) => ({ profile: "pglite", dataDir: join(dir, "db") }), contract));
  it("stops at its sweep and lifetime limits", () => temporary((dir) => ({ profile: "pglite", dataDir: join(dir, "db") }), limits), 120_000);
});
const url = process.env.A2A_TEST_POSTGRES_URL;
if (url && !decodeURIComponent(new URL(url).pathname).includes("test")) throw new Error("Use a test database");
(url ? describe : describe.skip)("automatic discovery (PostgreSQL)", () => {
  it("passes the same contract", () => temporary(() => ({ profile: "postgresql", url: url! }), contract));
  it("passes the same limits", () => temporary(() => ({ profile: "postgresql", url: url! }), limits), 120_000);
});
