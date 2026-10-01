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
    const url = "postgresql://a2a:secret@db.example.test:5432/a2a_ops";
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
        A2A_DATABASE_URL: `https://user:${secret}@db.example.test/a2a_ops`,
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
        url: "postgresql://localhost/a2a_ops",
      }).driver?.name,
    ).toBe("PostgreSqlDriver");
  });
});
