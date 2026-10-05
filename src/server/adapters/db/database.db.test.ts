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

const migrationNames = [
  "Migration20261001000000_Baseline",
  "Migration20261001131340_InitialModel",
  "Migration20261003000000_TaskContent",
  "Migration20261003010000_TaskCommands",
  "Migration20261003020000_TaskSubscriptions",
  "Migration20261003030000_TaskPushRegistrations",
  "Migration20261003045027_TaskReconciliation",
  "Migration20261003052730_VersionedTaskProjections",
  "Migration20261003060000_ApplicationFreshness",
  "Migration20261003080625_IdentitySessions",
  "Migration20261003100926_ScopedSecurity",
  "Migration20261005051700_DecisionAggregates",
  "Migration20261005081948_WorkflowOwnership",
  "Migration20261005091051_AuditImmutability",
];

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
    expect(await orm.migrator.getExecuted()).toHaveLength(14);
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally {
    await orm.close(true);
  }
}

describe("PGlite database adapter", () => {
  let dataDir: string;
  let reopenedOrm: MikroORM | undefined;

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "a2a-ops-pglite-"));
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
    expect(await reopenedOrm.migrator.getExecuted()).toHaveLength(14);
  });

  it("upgrades the immediately previous push schema", async () => {
    const upgradeDataDir = await mkdtemp(
      path.join(tmpdir(), "a2a-ops-pglite-upgrade-"),
    );
    const config = { profile: "pglite" as const, dataDir: upgradeDataDir };
    try {
      const previousOrm = await createDatabaseOrm(config);
      await previousOrm.migrator.up({ to: migrationNames[5] });
      await previousOrm.em.getConnection().execute(`insert into organizations (id, slug, name, created_at, updated_at) values ('00000000-0000-4000-a000-000000000001', 'upgrade', 'Upgrade', now(), now())`);
      await previousOrm.em.getConnection().execute(`insert into agents (id, organization_id, card_url, source, enabled, created_at, updated_at) values ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', 'https://upgrade.example.test', 'managed', true, now(), now())`);
      await previousOrm.em.getConnection().execute(`insert into tasks (id, organization_id, agent_id, tenant, remote_task_id, kind, state, created_at, updated_at) values ('00000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', '', 'retained', 'task', 'TASK_STATE_WORKING', now(), now())`);
      await previousOrm.em.getConnection().execute(`insert into task_subscriptions (id, organization_id, task_id, status, available_at, created_at, updated_at) values ('00000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000003', 'pending', now(), now(), now())`);
      await previousOrm.close(true);

      const upgradedOrm = await createDatabaseOrm(config);
      expect(
        (await upgradedOrm.migrator.getPending()).map(({ name }) => name),
      ).toEqual([migrationNames[6], migrationNames[7], migrationNames[8], migrationNames[9], migrationNames[10], migrationNames[11], migrationNames[12], migrationNames[13]]);
      await upgradedOrm.migrator.up();
      const rows = await upgradedOrm.em.getConnection().execute(`select remote_task_id, state, content_json from tasks where id = '00000000-0000-4000-a000-000000000003'`);
      expect(rows).toEqual([{ remote_task_id: "retained", state: "TASK_STATE_WORKING", content_json: {} }]);
      const adopted = await upgradedOrm.em.getConnection().execute(`select task_id, status from task_subscriptions`);
      expect(adopted).toEqual([{ task_id: "00000000-0000-4000-a000-000000000003", status: "pending" }]);
      const push = await upgradedOrm.em.getConnection().execute(`select count(*)::int as count from task_push_registrations`);
      expect(push).toEqual([{ count: 0 }]);
      const sync = await upgradedOrm.em.getConnection().execute(`select resource_key, task_id, status from sync_cursors order by resource_key`);
      expect(sync).toEqual([
        { resource_key: "", task_id: null, status: "pending" },
        { resource_key: "00000000-0000-4000-a000-000000000003", task_id: "00000000-0000-4000-a000-000000000003", status: "pending" },
      ]);
      expect(await upgradedOrm.migrator.checkSchema()).toBe(false);
      await upgradedOrm.close(true);
    } finally {
      await rm(upgradeDataDir, { force: true, recursive: true });
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
