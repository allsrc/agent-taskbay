import { mkdirSync } from "node:fs";
import path from "node:path";

import type { Options } from "@mikro-orm/core";
import { Migrator } from "@mikro-orm/migrations";
import { PgliteDriver } from "@mikro-orm/pglite";
import { PostgreSqlDriver } from "@mikro-orm/postgresql";
import { z } from "zod";

import { persistenceEntities } from "./entities";

const databaseEnvironmentSchema = z
  .object({
    A2A_DATABASE_PROFILE: z.enum(["pglite", "postgresql"]).default("pglite"),
    A2A_DATABASE_URL: z.string().trim().min(1).optional(),
    A2A_PGLITE_DATA_DIR: z.string().trim().min(1).optional(),
  })
  .superRefine((environment, context) => {
    if (environment.A2A_DATABASE_PROFILE !== "postgresql") {
      return;
    }

    if (!environment.A2A_DATABASE_URL) {
      context.addIssue({
        code: "custom",
        message: "A2A_DATABASE_URL is required for the postgresql profile",
        path: ["A2A_DATABASE_URL"],
      });
      return;
    }

    try {
      const url = new URL(environment.A2A_DATABASE_URL);
      if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
        context.addIssue({
          code: "custom",
          message: "A2A_DATABASE_URL must use the postgres or postgresql protocol",
          path: ["A2A_DATABASE_URL"],
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "A2A_DATABASE_URL must be a valid PostgreSQL URL",
        path: ["A2A_DATABASE_URL"],
      });
    }
  });

export type DatabaseConfig =
  | { profile: "pglite"; dataDir: string }
  | { profile: "postgresql"; url: string };

export class DatabaseConfigurationError extends Error {
  constructor(issues: z.core.$ZodIssue[]) {
    const message = issues
      .map((issue) => `${issue.path.join(".") || "database"}: ${issue.message}`)
      .join("; ");
    super(`Invalid database configuration: ${message}`);
    this.name = "DatabaseConfigurationError";
  }
}

export function loadDatabaseConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  workingDirectory = process.cwd(),
): DatabaseConfig {
  const parsed = databaseEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new DatabaseConfigurationError(parsed.error.issues);
  }

  if (parsed.data.A2A_DATABASE_PROFILE === "postgresql") {
    return { profile: "postgresql", url: parsed.data.A2A_DATABASE_URL! };
  }

  return {
    profile: "pglite",
    dataDir: path.resolve(
      workingDirectory,
      parsed.data.A2A_PGLITE_DATA_DIR ?? path.join(".data", "pglite"),
    ),
  };
}

const commonOptions = {
  baseDir: process.cwd(),
  entities: persistenceEntities,
  extensions: [Migrator],
  migrations: {
    emit: "cjs" as const,
    path: "./src/server/adapters/db/migrations",
    pathTs: "./src/server/adapters/db/migrations",
    snapshot: false,
    tableName: "agent_taskbay_migrations",
    transactional: true,
  },
};

export function createMikroOrmOptions(
  config = loadDatabaseConfig(),
): Partial<Options> {
  if (config.profile === "postgresql") {
    return {
      ...commonOptions,
      clientUrl: config.url,
      driver: PostgreSqlDriver,
    };
  }

  // PGlite creates its directory without `recursive`, so a clean checkout (no `.data`) would fail with ENOENT.
  mkdirSync(path.dirname(config.dataDir), { recursive: true });

  return {
    ...commonOptions,
    dbName: config.dataDir,
    driver: PgliteDriver,
  };
}
