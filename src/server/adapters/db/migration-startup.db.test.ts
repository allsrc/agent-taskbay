import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseOrm } from "./orm";
import { backupDirectoryName, KEPT_BACKUPS, migrateOnStartup, pruneBackups } from "./migration-startup";

const directories: string[] = [];
function scratch() {
  const root = mkdtempSync(path.join(tmpdir(), "agent-taskbay-startup-"));
  directories.push(root);
  return { root, dataDir: path.join(root, "pglite"), config: { profile: "pglite" as const, dataDir: path.join(root, "pglite") } };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const backups = (root: string) => readdirSync(root).filter((name) => name.startsWith("pglite.backup-"));

describe("migrateOnStartup", () => {
  it("creates a new database without a backup", async () => {
    const { root, config } = scratch();
    const messages: string[] = [];
    const orm = await migrateOnStartup(await createDatabaseOrm(config), config, () => createDatabaseOrm(config), (m) => messages.push(m));
    try {
      expect(messages).toEqual(["No existing database found. Creating a new one."]);
      expect(await orm.migrator.getPending()).toHaveLength(0);
      expect(backups(root)).toEqual([]);
    } finally { await orm.close(true); }
  });

  it("stays silent when an existing database is already current", async () => {
    const { root, config } = scratch();
    const first = await createDatabaseOrm(config);
    await first.migrator.up();
    await first.close(true);
    const messages: string[] = [];
    const orm = await migrateOnStartup(await createDatabaseOrm(config), config, () => createDatabaseOrm(config), (m) => messages.push(m));
    try {
      expect(messages).toEqual([]);
      expect(backups(root)).toEqual([]);
    } finally { await orm.close(true); }
  });

  it("backs up an existing database before upgrading it, and keeps working data", async () => {
    const { root, config } = scratch();
    const old = await createDatabaseOrm(config);
    await old.migrator.up();
    const connection = old.em.getConnection();
    await connection.execute(`insert into organizations (id, slug, name, created_at, updated_at) values ('00000000-0000-4000-a000-000000000001', 'kept', 'Kept', now(), now())`);
    // Stand in for a release that predates the current baseline: its history is recorded under another name.
    await connection.execute(`update agent_taskbay_migrations set name = 'Migration20261005130000_InboxIndex'`);
    await old.close(true);

    const messages: string[] = [];
    const orm = await migrateOnStartup(await createDatabaseOrm(config), config, () => createDatabaseOrm(config), (m) => messages.push(m));
    try {
      expect(messages[0]).toBe("Existing database found with 1 pending migration. Upgrading.");
      expect(messages[1]).toMatch(/^Backed up the database to .+pglite\.backup-/);
      expect(messages.at(-1)).toBe("Database upgraded.");
      expect(await orm.em.getConnection().execute(`select slug from organizations`)).toEqual([{ slug: "kept" }]);
      expect(await orm.migrator.getPending()).toHaveLength(0);

      // The copy is a database in its own right, still on the pre-upgrade state.
      const [backup] = backups(root);
      const copy = await createDatabaseOrm({ profile: "pglite", dataDir: path.join(root, backup) });
      try {
        expect((await copy.migrator.getExecuted()).map(({ name }) => name)).toEqual(["Migration20261005130000_InboxIndex"]);
        expect(await copy.em.getConnection().execute(`select slug from organizations`)).toEqual([{ slug: "kept" }]);
      } finally { await copy.close(true); }
    } finally { await orm.close(true); }
  });
});

describe("backup retention", () => {
  it("names backups by timestamp beside the data directory", () => {
    expect(backupDirectoryName("/data/pglite", new Date("2026-10-14T01:02:03.004Z"))).toBe("/data/pglite.backup-2026-10-14T01-02-03-004Z");
  });

  it("keeps only the newest backups and leaves other files alone", () => {
    const { root, dataDir } = scratch();
    mkdirSync(dataDir);
    const names = Array.from({ length: KEPT_BACKUPS + 2 }, (_, i) => `pglite.backup-2026-10-1${i}T00-00-00-000Z`);
    for (const name of names) mkdirSync(path.join(root, name));
    writeFileSync(path.join(root, "notes.txt"), "keep");
    pruneBackups(dataDir);
    expect(backups(root)).toEqual(names.slice(-KEPT_BACKUPS));
    expect(existsSync(path.join(root, "notes.txt"))).toBe(true);
    expect(existsSync(dataDir)).toBe(true);
  });
});
