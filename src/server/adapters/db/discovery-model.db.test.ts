import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentRecord, TaskRecord } from "../../domain/persistence-model";
import type { DatabaseConfig } from "./config";
import { createDatabaseOrm } from "./orm";
import { createPersistenceRepositories } from "./repositories";

const now = new Date("2026-10-01T00:00:00.000Z");
const agent = (organizationId: string, overrides: Partial<AgentRecord> = {}): AgentRecord => ({
  id: randomUUID(), organizationId, cardUrl: `https://agent-${randomUUID()}.example.test/card`, source: "managed", enabled: true, displayName: "Agent",
  description: null, protocolSnapshotVersion: null, lastDiscoveryAt: null, lastHealthyAt: null, createdAt: now, updatedAt: now, ...overrides,
});
const task = (organizationId: string, agentId: string, overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  id: randomUUID(), organizationId, agentId, tenant: "", remoteTaskId: `remote-${randomUUID()}`, remoteContextId: null, kind: "task", state: "TASK_STATE_WORKING",
  title: null, ownerUserId: null, ownerTeamId: null, createdAt: now, remoteCreatedAt: null, updatedAt: now, remoteUpdatedAt: null, terminalAt: null, version: 1, ...overrides,
});

async function contract(config: DatabaseConfig) {
  const orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    // Upgrade path: a database at the baseline, with rows written before these columns existed, then the newer migrations.
    await orm.migrator.up({ to: "Migration0001_Baseline" });
    const connection = orm.em.getConnection();
    const orgId = randomUUID(), oldAgent = randomUUID(), oldTask = randomUUID();
    await connection.execute(`insert into organizations (id, slug, name, created_at, updated_at) values ('${orgId}', 'upgrade', 'Upgrade', now(), now())`);
    await connection.execute(`insert into agents (id, organization_id, card_url, source, enabled, created_at, updated_at) values ('${oldAgent}', '${orgId}', 'https://old.example.test/card', 'managed', true, now(), now())`);
    await connection.execute(`insert into tasks (id, organization_id, agent_id, tenant, remote_task_id, kind, state, created_at, updated_at) values ('${oldTask}', '${orgId}', '${oldAgent}', '', 'old', 'task', 'TASK_STATE_WORKING', now(), now())`);
    await orm.migrator.up();
    const ports = createPersistenceRepositories(orm.em.fork());
    // Reads after a native update use a fresh entity manager, as separate requests do.
    const fresh = () => createPersistenceRepositories(orm.em.fork());
    expect(await ports.agents.findById(orgId, oldAgent)).toMatchObject({ taskDiscovery: "browse", taskDiscoveryHistoryDays: 7, taskDiscoveryPausedReason: null, extensionOverride: false });
    expect(await ports.tasks.findById(orgId, oldTask)).toMatchObject({ origin: "created", discoveredAt: null, trackedByUserId: null });

    // New rows without the optional fields take the defaults; the fields round-trip.
    const created = await ports.agents.getOrCreate(agent(orgId));
    expect(created).toMatchObject({ taskDiscovery: "browse", taskDiscoveryHistoryDays: 7, taskDiscoveryPausedReason: null });
    const tracker = randomUUID();
    const stored = await ports.tasks.insert(task(orgId, created.id, { origin: "discovered", discoveredAt: now, trackedByUserId: tracker }));
    expect(stored).toMatchObject({ origin: "discovered", discoveredAt: now, trackedByUserId: tracker });
    await ports.tasks.insert(task(orgId, created.id, { origin: "discovered", discoveredAt: now }));
    await ports.tasks.insert(task(orgId, created.id));
    expect(await ports.tasks.countDiscovered(orgId, created.id)).toBe(2);

    // Settings change, are validated, and are scoped to the organization.
    expect(await ports.agents.setTaskDiscovery(orgId, created.id, { taskDiscovery: "auto", taskDiscoveryHistoryDays: 30, taskDiscoveryPausedReason: "Reached the limit." }, now)).toBe(true);
    expect(await fresh().agents.findById(orgId, created.id)).toMatchObject({ taskDiscovery: "auto", taskDiscoveryHistoryDays: 30, taskDiscoveryPausedReason: "Reached the limit." });
    await ports.agents.setTaskDiscovery(orgId, created.id, { taskDiscoveryPausedReason: null }, now);
    expect((await fresh().agents.findById(orgId, created.id))!.taskDiscoveryPausedReason).toBeNull();
    await expect(ports.agents.setTaskDiscovery(orgId, created.id, { taskDiscovery: "everything" as never }, now)).rejects.toThrow("Invalid task discovery mode");
    for (const days of [-1, 91, 1.5]) await expect(ports.agents.setTaskDiscovery(orgId, created.id, { taskDiscoveryHistoryDays: days }, now)).rejects.toThrow("0 to 90");
    expect(await ports.agents.setTaskDiscovery(randomUUID(), created.id, { taskDiscovery: "off" }, now)).toBe(false);
    expect((await fresh().agents.findById(orgId, created.id))!.taskDiscovery).toBe("auto");

    // Two organizations never see each other's discovered tasks.
    const otherOrg = randomUUID();
    await connection.execute(`insert into organizations (id, slug, name, created_at, updated_at) values ('${otherOrg}', 'other', 'Other', now(), now())`);
    const foreign = await ports.agents.getOrCreate(agent(otherOrg));
    await ports.tasks.insert(task(otherOrg, foreign.id, { origin: "discovered", discoveredAt: now }));
    expect(await ports.tasks.countDiscovered(orgId, created.id)).toBe(2);
    expect(await ports.tasks.countDiscovered(orgId, foreign.id)).toBe(0);
    expect(await ports.tasks.countDiscovered(otherOrg, foreign.id)).toBe(1);

    // The sweep marker exists on cursors and defaults to null.
    const cursorRow = await connection.execute<Array<{ last_full_sweep_at: string | null }>>(`select last_full_sweep_at from sync_cursors limit 1`);
    expect(cursorRow).toEqual([]);
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally { await orm.close(true); }
}
async function temporary(config: (directory: string) => DatabaseConfig) {
  const directory = await mkdtemp(path.join(tmpdir(), "a2a-discovery-model-"));
  try { await contract(config(directory)); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("task discovery data model (PGlite)", () => {
  it("upgrades a database with existing rows and stores origin and settings", () => temporary((dir) => ({ profile: "pglite", dataDir: path.join(dir, "db") })));
});
const url = process.env.A2A_TEST_POSTGRES_URL;
if (url && !decodeURIComponent(new URL(url).pathname).includes("test")) throw new Error("Use a test database");
(url ? describe : describe.skip)("task discovery data model (PostgreSQL)", () => {
  it("passes the same contract", () => temporary(() => ({ profile: "postgresql", url: url! })));
});
