import { cpSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import type { MikroORM } from "@mikro-orm/core";

import type { DatabaseConfig } from "./config";

export const KEPT_BACKUPS = 3;

/** `<dir>.backup-<timestamp>`, a sibling of the PGlite directory so it is never read as part of it. */
export function backupDirectoryName(dataDir: string, now = new Date()): string {
  return `${dataDir}.backup-${now.toISOString().replace(/[:.]/g, "-")}`;
}

/** Copies a PGlite directory that no process has open. Returns the backup path. */
export function backupPgliteDirectory(dataDir: string, now = new Date()): string {
  const destination = backupDirectoryName(dataDir, now);
  cpSync(dataDir, destination, { recursive: true, errorOnExist: true, force: false });
  pruneBackups(dataDir);
  return destination;
}

/** Keeps the newest `keep` backups of this directory. Timestamps sort lexically. */
export function pruneBackups(dataDir: string, keep = KEPT_BACKUPS): void {
  const parent = path.dirname(dataDir);
  const prefix = `${path.basename(dataDir)}.backup-`;
  const backups = readdirSync(parent).filter((name) => name.startsWith(prefix)).sort();
  for (const name of backups.slice(0, Math.max(0, backups.length - keep))) {
    rmSync(path.join(parent, name), { recursive: true, force: true });
  }
}

export type Log = (message: string) => void;

/**
 * Applies pending migrations and says what is happening.
 *
 * - Nothing pending: silent.
 * - No migration recorded yet: a new installation, which creates its schema.
 * - Migrations recorded and some pending: an existing installation. An embedded PGlite database is copied first,
 *   because a failed migration may leave it unusable. PostgreSQL is the operator's to back up.
 *
 * Returns the ORM to keep using: the backup needs the directory closed, so the database is reopened afterwards.
 */
export async function migrateOnStartup(
  orm: MikroORM,
  config: DatabaseConfig,
  reopen: () => Promise<MikroORM>,
  log: Log = (message) => console.info(`[agent-taskbay] ${message}`),
): Promise<MikroORM> {
  // In turn: the first call creates the migrations table on a new database, and two at once would both try.
  const executed = await orm.migrator.getExecuted();
  const pending = await orm.migrator.getPending();
  if (pending.length === 0) return orm;

  if (executed.length === 0) {
    log("No existing database found. Creating a new one.");
    await orm.migrator.up();
    return orm;
  }

  log(`Existing database found with ${pending.length} pending ${pending.length === 1 ? "migration" : "migrations"}. Upgrading.`);
  let current = orm;
  if (config.profile === "pglite") {
    await orm.close(true);
    try {
      log(`Backed up the database to ${backupPgliteDirectory(config.dataDir)}`);
    } catch (error) {
      throw new Error(`Could not back up ${config.dataDir} before upgrading, so nothing was changed: ${(error as Error).message}`);
    }
    current = await reopen();
  } else {
    log("PostgreSQL is not backed up automatically. Make sure you have a backup.");
  }
  await current.migrator.up();
  log("Database upgraded.");
  return current;
}
