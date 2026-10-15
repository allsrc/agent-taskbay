import { readdirSync } from "node:fs";

/**
 * The schema version this release needs: the number of its newest migration. Migrations are numbered
 * `Migration<nnnn>_<Name>` and applied in order, so a database at version N reaches this version by
 * running every migration after N. A test keeps this equal to the files on disk. Raise it only by adding a migration.
 */
export const DB_SCHEMA_VERSION = 5;

const NUMBERED = /^Migration(\d{4})_/;

/** The version a migration brings the schema to, or undefined for the pre-numbering names of 0.2.0 and earlier. */
export function migrationNumber(name: string): number | undefined {
  const match = NUMBERED.exec(name);
  return match ? Number(match[1]) : undefined;
}

/** The newest numbered migration among `names`, or undefined when there is none (an empty or pre-numbering database). */
export function schemaVersionOf(names: readonly string[]): number | undefined {
  const numbers = names.map(migrationNumber).filter((n): n is number => n !== undefined);
  return numbers.length ? Math.max(...numbers) : undefined;
}

/** `Migration0002_AddThing` for the next free number in `directory`. Used by `npm run db:migration:create`. */
export function nextMigrationName(directory: string, slug = "Change"): string {
  const newest = schemaVersionOf(readdirSync(directory).map((file) => file.replace(/\.[cm]?[jt]s$/, ""))) ?? 0;
  return `Migration${String(newest + 1).padStart(4, "0")}_${slug.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Change"}`;
}
