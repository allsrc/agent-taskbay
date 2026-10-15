import { cpSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import type { MikroORM } from "@mikro-orm/core";

import type { DatabaseConfig } from "./config";
import { DB_SCHEMA_VERSION, schemaVersionOf } from "./schema-version";

export const KEPT_BACKUPS = 3;

/**
 * `<dir>.backup-v<schema version>-<timestamp>`, a sibling of the PGlite directory so it is never read as part of it.
 * The version says what the copy contains; the timestamp keeps repeated backups of one version apart.
 * A database from before schema numbering is labelled `v0`.
 */
export function backupDirectoryName(dataDir: string, schemaVersion: number, now = new Date()): string {
  return `${dataDir}.backup-v${schemaVersion}-${now.toISOString().replace(/[:.]/g, "-")}`;
}

/** Copies a PGlite directory that no process has open. Returns the backup path. */
export function backupPgliteDirectory(dataDir: string, schemaVersion: number, now = new Date()): string {
  const destination = backupDirectoryName(dataDir, schemaVersion, now);
  cpSync(dataDir, destination, { recursive: true, errorOnExist: true, force: false });
  pruneBackups(dataDir);
  return destination;
}

/** Keeps the newest `keep` backups of this directory, ordered by their timestamps, which sort lexically. */
export function pruneBackups(dataDir: string, keep = KEPT_BACKUPS): void {
  const parent = path.dirname(dataDir);
  const prefix = `${path.basename(dataDir)}.backup-`;
  const age = (name: string) => name.slice(prefix.length).replace(/^v\d+-/, "");
  const backups = readdirSync(parent).filter((name) => name.startsWith(prefix)).sort((a, b) => age(a).localeCompare(age(b)));
  for (const name of backups.slice(0, Math.max(0, backups.length - keep))) {
    rmSync(path.join(parent, name), { recursive: true, force: true });
  }
}

export type Log = (message: string) => void;

/**
 * Applies pending migrations and says what is happening.
 *
 * - A database newer than this release (a downgrade): refused.
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
  // Names from before schema numbering have no version; they count as 0.
  const from = schemaVersionOf(executed.map(({ name }) => name)) ?? 0;
  if (from > DB_SCHEMA_VERSION) {
    throw new Error(
      `This database is at schema v${from}, but this version of Agent Taskbay only knows schema v${DB_SCHEMA_VERSION}. ` +
        "Start a newer version, or restore a backup taken before the upgrade.",
    );
  }
  if (pending.length === 0) return orm;

  if (executed.length === 0) {
    log(`No existing database found. Creating a new one (schema v${DB_SCHEMA_VERSION}).`);
    await orm.migrator.up();
    return orm;
  }

  log(`Existing database found at schema v${from}. Upgrading to v${DB_SCHEMA_VERSION}.`);
  let current = orm;
  if (config.profile === "pglite") {
    await orm.close(true);
    try {
      log(`Backed up the database to ${backupPgliteDirectory(config.dataDir, from)}`);
    } catch (error) {
      throw new Error(`Could not back up ${config.dataDir} before upgrading, so nothing was changed: ${(error as Error).message}`);
    }
    current = await reopen();
  } else {
    log("PostgreSQL is not backed up automatically. Make sure you have a backup.");
  }
  await current.migrator.up();
  log(`Database upgraded to schema v${DB_SCHEMA_VERSION}.`);
  return current;
}
