import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DatabaseConfigurationError,
  createMikroOrmOptions,
  loadDatabaseConfig,
} from "./config";

describe("database configuration", () => {
  it("uses a file-backed PGlite database by default", () => {
    expect(loadDatabaseConfig({}, "/workspace")).toEqual({
      profile: "pglite",
      dataDir: path.resolve("/workspace/.data/pglite"),
    });
  });

  it("accepts an explicit PostgreSQL URL", () => {
    const url = "postgresql://a2a:secret@db.example.test:5432/agent_taskbay";
    expect(
      loadDatabaseConfig({
        A2A_DATABASE_PROFILE: "postgresql",
        A2A_DATABASE_URL: url,
      }),
    ).toEqual({ profile: "postgresql", url });
  });

  it("rejects missing and non-PostgreSQL production URLs without echoing secrets", () => {
    expect(() =>
      loadDatabaseConfig({ A2A_DATABASE_PROFILE: "postgresql" }),
    ).toThrow(DatabaseConfigurationError);

    const secret = "do-not-log-this";
    expect(() =>
      loadDatabaseConfig({
        A2A_DATABASE_PROFILE: "postgresql",
        A2A_DATABASE_URL: `https://user:${secret}@db.example.test/agent_taskbay`,
      }),
    ).toThrowError(new RegExp(`^(?!.*${secret}).*$`));
  });

  it("selects the matching official MikroORM driver", () => {
    expect(
      createMikroOrmOptions({ profile: "pglite", dataDir: "/tmp/a2a-pglite" })
        .driver?.name,
    ).toBe("PgliteDriver");
    expect(
      createMikroOrmOptions({
        profile: "postgresql",
        url: "postgresql://localhost/agent_taskbay",
      }).driver?.name,
    ).toBe("PostgreSqlDriver");
  });

  // DX-001: a clean checkout has no `.data` directory and PGlite does not create parents.
  it("creates the parent of the PGlite directory so a clean checkout can start", () => {
    const root = mkdtempSync(path.join(tmpdir(), "taskbay-config-"));
    try {
      const dataDir = path.join(root, "nested", ".data", "pglite");
      createMikroOrmOptions({ profile: "pglite", dataDir });
      expect(existsSync(path.dirname(dataDir))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
