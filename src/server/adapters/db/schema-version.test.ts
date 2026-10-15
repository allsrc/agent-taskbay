import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { DB_SCHEMA_VERSION, migrationNumber, nextMigrationName, schemaVersionOf } from "./schema-version";

const migrationsDirectory = path.join(__dirname, "migrations");
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

it("declares the schema version the migrations on disk reach, numbered without gaps from 1", () => {
  const numbers = readdirSync(migrationsDirectory)
    .map((file) => migrationNumber(file))
    .filter((n): n is number => n !== undefined);
  expect(numbers).toHaveLength(readdirSync(migrationsDirectory).length); // every file is numbered
  expect(numbers.toSorted((a, b) => a - b)).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
  expect(DB_SCHEMA_VERSION).toBe(Math.max(...numbers));
});

it("reads versions from migration names and treats the pre-numbering names as no version", () => {
  expect(migrationNumber("Migration0007_AddThing")).toBe(7);
  expect(migrationNumber("Migration20261005130000_InboxIndex")).toBeUndefined();
  expect(schemaVersionOf(["Migration0001_Baseline", "Migration0003_X", "Migration0002_Y"])).toBe(3);
  expect(schemaVersionOf(["Migration20261005130000_InboxIndex"])).toBeUndefined();
  expect(schemaVersionOf([])).toBeUndefined();
});

it("names the next migration after the newest one on disk", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "agent-taskbay-names-"));
  directories.push(directory);
  mkdirSync(directory, { recursive: true });
  expect(nextMigrationName(directory)).toBe("Migration0001_Change");
  writeFileSync(path.join(directory, "Migration0001_Baseline.js"), "");
  writeFileSync(path.join(directory, "Migration0002_AddThing.ts"), "");
  expect(nextMigrationName(directory)).toBe("Migration0003_Change");
  expect(nextMigrationName(directory, "add task labels")).toBe("Migration0003_add_task_labels");
});
