import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AgentCatalogService, legacyAgentIdFromCardUrl } from "../../application/services/agent-catalog";
import type { AgentDiscoverySnapshot } from "../../application/ports/agent-registry";
import type { DatabaseConfig } from "./config";
import { DatabaseAgentRegistry } from "./agent-registry";
import { AgentCardSnapshotEntity } from "./entities";
import { createDatabaseOrm } from "./orm";
import { createPersistenceRepositories } from "./repositories";

const managedUrl = "https://managed.example.test/card.json";
const envUrl = "https://env.example.test/card.json";
const sharedUrl = "https://shared.example.test/card.json";
const snapshot: AgentDiscoverySnapshot = {
  resolvedCardUrl: managedUrl,
  rawCardJson: { name: "Raw agent", signatures: [{ advertised: true }] },
  normalizedCardJson: { name: "Normalized agent", supportedInterfaces: [] },
  complianceJson: { version: "1.0", score: 90, issues: [{ severity: "warning" }] },
  digest: "a".repeat(64),
  displayName: "Normalized agent", description: "Discovery description", protocolSnapshotVersion: "1.0",
};

// AGT-001..003 / TST-001: run exactly the same registry behavior on both adapters.
async function registryContract(config: DatabaseConfig, legacyFilePath: string) {
  let orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const legacyContents = JSON.stringify([{ cardUrl: managedUrl }, { cardUrl: managedUrl }, { cardUrl: sharedUrl }]);
    await writeFile(legacyFilePath, legacyContents);
    let environmentUrls = [envUrl, envUrl, sharedUrl];
    const options = () => ({ orm, legacyFilePath, environmentUrls: () => environmentUrls });
    let registry = new DatabaseAgentRegistry(options());
    const initial = await registry.list();
    expect(initial).toHaveLength(3);
    expect(initial.every((agent) => /^[0-9a-f-]{36}$/.test(agent.id))).toBe(true);
    const managed = initial.find((agent) => agent.cardUrl === managedUrl)!;
    const env = initial.find((agent) => agent.cardUrl === envUrl)!;
    const shared = initial.find((agent) => agent.cardUrl === sharedUrl)!;
    expect(shared.source).toBe("env");
    expect(await registry.add(sharedUrl)).toEqual(shared);
    expect(await registry.get(legacyAgentIdFromCardUrl(managedUrl))).toEqual(managed);
    expect(await registry.get("unknown")).toBeUndefined();
    expect(await registry.remove(env.id)).toBe(false);
    expect(await registry.remove(legacyAgentIdFromCardUrl(sharedUrl))).toBe(false);

    const additions = await Promise.all([
      registry.add(" https://concurrent.example.test/card.json "),
      new DatabaseAgentRegistry(options()).add("https://concurrent.example.test/card.json"),
    ]);
    expect(additions[0]).toEqual(additions[1]);
    expect(await registry.list()).toHaveLength(4);
    await expect(registry.add("file:///tmp/card.json")).rejects.toThrow();

    await registry.recordDiscovery(managed.id, snapshot);
    const repositories = createPersistenceRepositories(orm.em.fork({ clear: true, useContext: false }));
    const organization = (await repositories.organizations.findBySlug("local"))!;
    const firstSnapshot = (await repositories.agents.findLatestCardSnapshot(managed.id))!;
    expect(firstSnapshot).toMatchObject({
      agentId: managed.id, rawCardJson: snapshot.rawCardJson,
      normalizedCardJson: snapshot.normalizedCardJson, complianceJson: snapshot.complianceJson,
      signatureStatus: "unverified", digest: snapshot.digest,
    });
    expect(await repositories.agents.findById(organization.id, managed.id)).toMatchObject({
      displayName: snapshot.displayName, description: snapshot.description,
      protocolSnapshotVersion: "1.0", lastDiscoveryAt: firstSnapshot.fetchedAt,
      lastHealthyAt: firstSnapshot.fetchedAt,
    });
    // A failed metadata write must roll back the preceding snapshot append.
    await expect(registry.recordDiscovery(managed.id, { ...snapshot, displayName: "x".repeat(301) })).rejects.toThrow();
    expect(await orm.em.fork().count(AgentCardSnapshotEntity, { agentId: managed.id })).toBe(1);
    await registry.recordDiscovery(managed.id, { ...snapshot, rawCardJson: { name: "Changed" }, digest: "b".repeat(64) });
    expect(await orm.em.fork().count(AgentCardSnapshotEntity, { agentId: managed.id })).toBe(2);
    await expect(registry.recordDiscovery("unknown", snapshot)).rejects.toThrow("Unknown agent");

    const otherOrganization = await repositories.organizations.getOrCreate({
      id: randomUUID(), slug: "other", name: "Other", createdAt: new Date(), updatedAt: new Date(),
    });
    const otherCatalog = new AgentCatalogService(repositories.agents, otherOrganization.id, []);
    expect(await otherCatalog.list()).toEqual([]);
    expect(await otherCatalog.get(managed.id)).toBeUndefined();
    expect(await otherCatalog.remove(managed.id)).toBe(false);
    await expect(otherCatalog.recordDiscovery(managed.id, snapshot)).rejects.toThrow("Unknown agent");
    expect(await repositories.agents.updateRegistration(otherOrganization.id, managed.id, {
      source: "managed", enabled: false, updatedAt: new Date(),
    })).toBe(false);
    const otherAgent = await otherCatalog.add(managedUrl);
    expect(otherAgent.id).not.toBe(managed.id);
    expect((await registry.list()).some((agent) => agent.id === otherAgent.id)).toBe(false);

    expect(await registry.remove(managed.id)).toBe(true);
    expect(await registry.remove(managed.id)).toBe(false);
    expect(await registry.get(managed.id)).toBeUndefined();
    expect(await readFile(legacyFilePath, "utf8")).toBe(legacyContents);
    await orm.close(true);
    orm = await createDatabaseOrm(config);
    registry = new DatabaseAgentRegistry(options());
    const restarted = await registry.list();
    expect(restarted).toHaveLength(3);
    expect(await registry.get(managed.id)).toBeUndefined();
    expect(await registry.get(env.id)).toEqual(env);
    const restartedRepositories = createPersistenceRepositories(orm.em.fork());
    expect(await restartedRepositories.agents.findLatestCardSnapshot(managed.id)).toMatchObject({
      rawCardJson: { name: "Changed" }, digest: "b".repeat(64),
    });
    // Explicit registration re-enables the original durable identity.
    expect(await registry.add(managedUrl)).toEqual(managed);
    environmentUrls = [];
    expect(await registry.get(env.id)).toBeUndefined();
    expect(await registry.get(shared.id)).toEqual({ ...shared, source: "managed" });
    expect(await registry.add(envUrl)).toEqual({ ...env, source: "managed" });
    expect(await registry.remove(env.id)).toBe(true);
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally {
    await orm.close(true);
  }
}

async function inTemporaryDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-ops-registry-"));
  try { await run(directory); }
  finally { await rm(directory, { force: true, recursive: true }); }
}

describe("PGlite durable registry", () => {
  it("imports, protects seeds, persists discovery, and recovers after restart", async () => {
    await inTemporaryDirectory((directory) => registryContract(
      { profile: "pglite", dataDir: join(directory, "db") }, join(directory, "agents.json"),
    ));
  });

  it("fails closed on malformed imports and retries after the file is repaired", async () => {
    await inTemporaryDirectory(async (directory) => {
      const orm = await createDatabaseOrm({ profile: "pglite", dataDir: join(directory, "db") });
      try {
        await orm.migrator.up();
        const legacyFilePath = join(directory, "agents.json");
        const registry = new DatabaseAgentRegistry({ orm, legacyFilePath, environmentUrls: () => [] });
        await writeFile(legacyFilePath, JSON.stringify([{ cardUrl: managedUrl }, { cardUrl: "file:///invalid" }]));
        await expect(registry.list()).rejects.toThrow();
        const repositories = createPersistenceRepositories(orm.em.fork());
        expect(await repositories.organizations.findBySlug("local")).toBeUndefined();
        await writeFile(legacyFilePath, "{invalid json");
        await expect(registry.list()).rejects.toThrow();
        await writeFile(legacyFilePath, JSON.stringify([{ cardUrl: managedUrl }, {}]));
        await expect(registry.list()).rejects.toThrow("Legacy agents.json");
        await writeFile(legacyFilePath, JSON.stringify([{ cardUrl: managedUrl }]));
        expect(await registry.list()).toHaveLength(1);
      } finally { await orm.close(true); }
    });
  });

  it("starts without a legacy file and survives removal of that file", async () => {
    await inTemporaryDirectory(async (directory) => {
      const orm = await createDatabaseOrm({ profile: "pglite", dataDir: join(directory, "db") });
      try {
        await orm.migrator.up();
        const options = { orm, legacyFilePath: join(directory, "missing.json"), environmentUrls: () => [] };
        const registry = new DatabaseAgentRegistry(options);
        expect(await registry.list()).toEqual([]);
        const agent = await registry.add(managedUrl);
        expect(await new DatabaseAgentRegistry(options).get(agent.id)).toEqual(agent);
      } finally { await orm.close(true); }
    });
  });
});

const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
if (process.env.CI === "true" && !postgresUrl) throw new Error("CI must set A2A_TEST_POSTGRES_URL");
if (postgresUrl && !decodeURIComponent(new URL(postgresUrl).pathname).includes("test")) {
  throw new Error("A2A_TEST_POSTGRES_URL must target a database containing 'test' in its name");
}
const describePostgreSql = postgresUrl ? describe : describe.skip;
describePostgreSql("PostgreSQL durable registry", () => {
  it("runs the same restart, import, discovery, and tenancy contract as PGlite", async () => {
    await inTemporaryDirectory((directory) => registryContract(
      { profile: "postgresql", url: postgresUrl! }, join(directory, "agents.json"),
    ));
  });
});
