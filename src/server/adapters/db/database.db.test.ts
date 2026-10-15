import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { MikroORM } from "@mikro-orm/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DatabaseConfig } from "./config";
import {
  createDatabaseOrm,
  withJobEntityManager,
  withRequestEntityManager,
} from "./orm";

const migrationNames = ["Migration0001_Baseline", "Migration0002_TaskDiscovery", "Migration0003_CommandErrorKind", "Migration0004_AgentExtensionOverride", "Migration0005_DiscoverySweepProgress"];

async function verifyMigrationContract(config: DatabaseConfig) {
  const orm = await createDatabaseOrm(config);
  try {
    expect(await orm.checkConnection()).toEqual({ ok: true });
    if ((await orm.migrator.getExecuted()).length > 0) {
      await orm.migrator.down({ to: 0 });
    }
    expect((await orm.migrator.getPending()).map(({ name }) => name)).toEqual(
      migrationNames,
    );

    const applied = await orm.migrator.up();
    expect(applied.map((migration) => migration.name)).toEqual(migrationNames);
    expect(await orm.migrator.getPending()).toHaveLength(0);
    expect(await orm.migrator.getExecuted()).toHaveLength(migrationNames.length);
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally {
    await orm.close(true);
  }
}

describe("PGlite database adapter", () => {
  let dataDir: string;
  let reopenedOrm: MikroORM | undefined;

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "agent-taskbay-pglite-"));
  });

  afterAll(async () => {
    await reopenedOrm?.close(true);
    await rm(dataDir, { force: true, recursive: true });
  });

  it("runs the migration contract and persists migration state across restart", async () => {
    const config = { profile: "pglite" as const, dataDir };
    await verifyMigrationContract(config);

    reopenedOrm = await createDatabaseOrm(config);
    expect(await reopenedOrm.migrator.getPending()).toHaveLength(0);
    expect(await reopenedOrm.migrator.getExecuted()).toHaveLength(migrationNames.length);
  });

  it("adopts a database created by the migrations that came before the squashed baseline", async () => {
    const legacyDataDir = await mkdtemp(path.join(tmpdir(), "agent-taskbay-pglite-legacy-"));
    try {
      const orm = await createDatabaseOrm({ profile: "pglite", dataDir: legacyDataDir });
      // The old chain ended at the schema the baseline describes; later migrations are still to run after adoption.
      await orm.migrator.up({ to: "Migration0001_Baseline" });
      const connection = orm.em.getConnection();
      await connection.execute(`insert into organizations (id, slug, name, created_at, updated_at) values ('00000000-0000-4000-a000-000000000001', 'kept', 'Kept', now(), now())`);
      // What the old chain left behind: its own names in the migrations table, in place of the baseline's.
      await connection.execute(`delete from agent_taskbay_migrations`);
      await connection.execute(`insert into agent_taskbay_migrations (name) values ('Migration20261001000000_Baseline'), ('Migration20261005111024_Notifications'), ('Migration20261005130000_InboxIndex')`);
      expect((await orm.migrator.getPending()).map(({ name }) => name)).toEqual(migrationNames);

      await orm.migrator.up();
      expect((await orm.migrator.getExecuted()).map(({ name }) => name)).toEqual(migrationNames);
      expect(await connection.execute(`select slug from organizations`)).toEqual([{ slug: "kept" }]);
      expect(await orm.migrator.checkSchema()).toBe(false);
      await orm.close(true);
    } finally {
      await rm(legacyDataDir, { force: true, recursive: true });
    }
  });

  it("refuses a database left part way through the old migrations", async () => {
    const partialDataDir = await mkdtemp(path.join(tmpdir(), "agent-taskbay-pglite-partial-"));
    try {
      const orm = await createDatabaseOrm({ profile: "pglite", dataDir: partialDataDir });
      await orm.migrator.up();
      const connection = orm.em.getConnection();
      await connection.execute(`delete from agent_taskbay_migrations`);
      await connection.execute(`insert into agent_taskbay_migrations (name) values ('Migration20261003060000_ApplicationFreshness')`);
      await expect(orm.migrator.up()).rejects.toThrow("missing some of its migrations");
      expect((await orm.migrator.getExecuted()).map(({ name }) => name)).toEqual(["Migration20261003060000_ApplicationFreshness"]);
      await orm.close(true);
    } finally {
      await rm(partialDataDir, { force: true, recursive: true });
    }
  });

  it("forks an isolated EntityManager for each request and worker job", async () => {
    reopenedOrm ??= await createDatabaseOrm({
      profile: "pglite",
      dataDir,
    });

    const requestManagers = await Promise.all([
      withRequestEntityManager((entityManager) => entityManager, reopenedOrm),
      withRequestEntityManager((entityManager) => entityManager, reopenedOrm),
    ]);
    const jobManagers = await Promise.all([
      withJobEntityManager((entityManager) => entityManager, reopenedOrm),
      withJobEntityManager((entityManager) => entityManager, reopenedOrm),
    ]);

    expect(requestManagers[0]).not.toBe(reopenedOrm.em);
    expect(requestManagers[0]).not.toBe(requestManagers[1]);
    expect(jobManagers[0]).not.toBe(reopenedOrm.em);
    expect(jobManagers[0]).not.toBe(jobManagers[1]);
  });
});

const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
if (process.env.CI === "true" && !postgresUrl) {
  throw new Error("CI must set A2A_TEST_POSTGRES_URL for the PostgreSQL contract");
}
if (postgresUrl && !decodeURIComponent(new URL(postgresUrl).pathname).includes("test")) {
  throw new Error("A2A_TEST_POSTGRES_URL must target a database containing 'test' in its name");
}
const describePostgreSql = postgresUrl ? describe : describe.skip;

describePostgreSql("PostgreSQL database adapter", () => {
  it("runs the same migration contract as PGlite", async () => {
    await verifyMigrationContract({
      profile: "postgresql",
      url: postgresUrl!,
    });
  });
});
