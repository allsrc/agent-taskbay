import { expect, it } from "vitest";
import { shouldAutoMigrate } from "./orm";

// ADR 0025: in-place migration is automatic only where one process owns the database.
it("migrates automatically for next dev on PGlite and for an explicit opt-in", () => {
  expect(shouldAutoMigrate({ NODE_ENV: "development" })).toBe(true);
  expect(shouldAutoMigrate({ NODE_ENV: "development", A2A_DATABASE_PROFILE: "pglite" })).toBe(true);
  expect(shouldAutoMigrate({ NODE_ENV: "production", A2A_AUTO_MIGRATE: "true" })).toBe(true);
});

it("keeps migration explicit for production, tests and PostgreSQL unless opted in", () => {
  expect(shouldAutoMigrate({ NODE_ENV: "production" })).toBe(false);
  expect(shouldAutoMigrate({ NODE_ENV: "test" })).toBe(false);
  expect(shouldAutoMigrate({ NODE_ENV: "development", A2A_DATABASE_PROFILE: "postgresql" })).toBe(false);
  expect(shouldAutoMigrate({ NODE_ENV: "production", A2A_DATABASE_PROFILE: "postgresql", A2A_AUTO_MIGRATE: "true" })).toBe(true);
});

it("lets an explicit setting turn development auto-migration off", () => {
  expect(shouldAutoMigrate({ NODE_ENV: "development", A2A_AUTO_MIGRATE: "false" })).toBe(false);
});
