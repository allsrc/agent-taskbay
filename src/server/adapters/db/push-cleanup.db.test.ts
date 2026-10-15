import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DatabaseConfig } from "./config";
import type { A2APushGateway, PushConfigSummary } from "../../application/ports/push";
import type { AgentRecord, TaskRecord } from "../../domain/persistence-model";
import { bootstrapRuntimeDatabase, createDatabaseOrm } from "./orm";
import { createPersistenceRepositories } from "./repositories";
import { PushRegistrationEntity, RateBucketEntity, SecurityAuditEntity } from "./entities";
import { createPushWorker } from "../../runtime/push";
import { loadPushCredentials } from "../../runtime/push-config";

const credentials = loadPushCredentials({ A2A_PUSH_CALLBACK_ORIGIN: "https://console.example.test", A2A_PUSH_SIGNING_KEY: "cd".repeat(32) })!;
const old = new Date(Date.now() - 3 * 24 * 60 * 60_000);
const task = (organizationId: string, agentId: string, remote: string): TaskRecord => ({
  id: randomUUID(), organizationId, agentId, tenant: "", remoteTaskId: remote, remoteContextId: "c", kind: "task", state: "TASK_STATE_COMPLETED",
  title: null, ownerUserId: null, ownerTeamId: null, createdAt: old, remoteCreatedAt: null, updatedAt: old, remoteUpdatedAt: null,
  terminalAt: old, version: 1, contentJson: {},
});

const agent = (organizationId: string, cardUrl: string): AgentRecord => ({ id: randomUUID(), organizationId, cardUrl, source: "managed", enabled: true,
  displayName: "Agent", description: null, protocolSnapshotVersion: null, lastDiscoveryAt: null, lastHealthyAt: null, createdAt: old, updatedAt: old });
async function contract(config: DatabaseConfig) {
  const orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const ports = () => createPersistenceRepositories(orm.em.fork());
    const orgA = await bootstrapRuntimeDatabase(orm);
    const orgB = await ports().organizations.getOrCreate({ id: randomUUID(), slug: "other", name: "Other", createdAt: old, updatedAt: old });
    const agentA = await ports().agents.insert(agent(orgA.id, "https://a.example.test/card"));
    const agentB = await ports().agents.insert(agent(orgB.id, "https://b.example.test/card"));

    // Per-task configs held by the fake agent. Every task is finished and its registration is deleted.
    const held = new Map<string, PushConfigSummary[]>();
    const calls = { list: 0, remove: [] as string[] };
    let mode: "ok" | "unsupported" | "down" = "ok";
    const gateway: A2APushGateway = {
      register: async () => undefined,
      list: async (_agent, remote) => {
        calls.list++;
        if (mode === "down") throw new Error("Agent unreachable");
        return mode === "unsupported" ? [] : [...(held.get(remote.remoteTaskId!) ?? [])];
      },
      remove: async (_agent, remote, id) => {
        calls.remove.push(`${remote.remoteTaskId}:${id}`);
        held.set(remote.remoteTaskId!, (held.get(remote.remoteTaskId!) ?? []).filter((entry) => entry.id !== id));
      },
    };
    const worker = () => createPushWorker({ orm, credentials, gateway });
    const shutdown = new AbortController();
    const seed = async (organizationId: string, agentId: string, remote: string, configs: (registrationId: string) => PushConfigSummary[]) => {
      const row = await ports().tasks.insert(task(organizationId, agentId, remote));
      await orm.em.fork().insert(PushRegistrationEntity, { id: randomUUID(), organizationId, taskId: row.id, status: "deleted", desired: false,
        availableAt: old, attempts: 1, rateWindow: old, rateCount: 0, createdAt: old, updatedAt: old });
      const registration = (await ports().push.findByTaskId(organizationId, row.id))!;
      held.set(remote, configs(registration.id));
      return registration;
    };
    const prefix = "https://console.example.test/api/webhooks/a2a/";
    const own = await seed(orgA.id, agentA.id, "t-own-id", (id) => [{ id, url: "https://elsewhere.example.test/hook" }]);
    await seed(orgA.id, agentA.id, "t-own-url", () => [{ id: "legacy", url: `${prefix}${randomUUID()}` }]);
    await seed(orgA.id, agentA.id, "t-foreign", () => [{ id: "mine", url: "https://elsewhere.example.test/hook" }]);
    await seed(orgB.id, agentB.id, "t-other-org", () => [{ id: "legacy", url: `${prefix}${randomUUID()}` }]);

    const drain = async () => { let cleaned = 0; for (let index = 0; index < 4; index++) cleaned += (await worker().cleanupOne(shutdown.signal)) ?? 0; return cleaned; };
    expect(await drain()).toBe(3);
    expect(calls.remove.sort()).toEqual(["t-other-org:legacy", "t-own-id:" + own.id, "t-own-url:legacy"].sort());
    expect(held.get("t-foreign")).toEqual([{ id: "mine", url: "https://elsewhere.example.test/hook" }]);
    const audits = await orm.em.fork().find(SecurityAuditEntity, { action: { $like: "push.cleanup.%" } });
    expect(audits.map((row) => [row.organizationId, row.action, row.targetId]).sort()).toEqual([
      [orgA.id, "push.cleanup.2", agentA.id], [orgB.id, "push.cleanup.1", agentB.id]].sort());

    // A second run is a no-op: nothing is due until the recheck period passes, and no agent is asked again.
    const listed = calls.list;
    expect(await drain()).toBe(0);
    expect(calls.list).toBe(listed); expect(calls.remove).toHaveLength(3);

    // Two workers racing for the same due agent: one passes the shared claim, the other does nothing.
    await orm.em.fork().nativeUpdate(PushRegistrationEntity, {}, { updatedAt: old });
    await orm.em.fork().nativeUpdate(RateBucketEntity, {}, { expiresAt: new Date(0) });
    held.set("t-own-id", [{ id: own.id, url: "https://elsewhere.example.test/hook" }]);
    const before = calls.remove.length;
    const results = await Promise.all([worker().cleanupOne(shutdown.signal), worker().cleanupOne(shutdown.signal), worker().cleanupOne(shutdown.signal)]);
    expect(results.filter((value) => value === undefined).length).toBeGreaterThanOrEqual(1);
    expect(calls.remove.length - before).toBeLessThanOrEqual(1);

    // An agent without push support, or one that is down, is not an error and not retried in a storm.
    await orm.em.fork().nativeUpdate(PushRegistrationEntity, {}, { updatedAt: old });
    await orm.em.fork().nativeUpdate(RateBucketEntity, {}, { expiresAt: new Date(0) });
    mode = "unsupported";
    await expect(drain()).resolves.toBe(0);
    expect((await orm.em.fork().find(PushRegistrationEntity, {})).every((row) => row.updatedAt > old)).toBe(true);
    await orm.em.fork().nativeUpdate(PushRegistrationEntity, {}, { updatedAt: old });
    await orm.em.fork().nativeUpdate(RateBucketEntity, {}, { expiresAt: new Date(0) });
    mode = "down";
    const attempts = calls.list;
    await expect(drain()).resolves.toBe(0);
    expect(calls.list - attempts).toBeLessThanOrEqual(2);
    expect((await orm.em.fork().find(PushRegistrationEntity, {})).every((row) => row.updatedAt.getTime() === old.getTime())).toBe(true);
  } finally { await orm.close(true); }
}
describe("push configuration cleanup (PGlite)", () => {
  it("removes only Taskbay's own leftover configurations, once, with several workers", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
    const directory = await mkdtemp(join(tmpdir(), "a2a-cleanup-"));
    try { await contract({ profile: "pglite", dataDir: join(directory, "db") }); } finally { await rm(directory, { recursive: true, force: true }); }
  }, 30_000);
});
const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
if (postgresUrl && !decodeURIComponent(new URL(postgresUrl).pathname).includes("test")) throw new Error("A2A_TEST_POSTGRES_URL must target a test database");
(postgresUrl ? describe : describe.skip)("push configuration cleanup (PostgreSQL)", () => {
  it("passes the same contract", () => contract({ profile: "postgresql", url: postgresUrl! }), 30_000);
});
