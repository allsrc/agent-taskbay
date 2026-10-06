import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { UsageError, buildEnvironment, connectHost, isLoopbackHost, loadOrCreateSecrets, parseArgs, resolveDataDir } from "./launcher.mjs";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "taskbay-launcher-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// OPS-003: one command starts the console locally.
it("defaults to start and parses options in both spellings", () => {
  expect(parseArgs([])).toMatchObject({ command: "start", options: { open: undefined } });
  expect(parseArgs(["--port", "4000", "--host=localhost", "--no-open", "--data-dir", "/x"]).options)
    .toEqual({ open: false, port: 4000, host: "localhost", dataDir: "/x" });
  expect(parseArgs(["demo-agent", "4100"])).toMatchObject({ command: "demo-agent", positional: ["4100"] });
  expect(parseArgs(["--help"]).command).toBe("help");
  expect(parseArgs(["-v"]).command).toBe("version");
});

it("rejects bad input with a usage error", () => {
  expect(() => parseArgs(["--port", "70000"])).toThrow(UsageError);
  expect(() => parseArgs(["--port"])).toThrow("needs a value");
  expect(() => parseArgs(["--nope"])).toThrow("Unknown option");
  expect(() => parseArgs(["start", "extra"])).toThrow("Unexpected argument");
});

it("recognises loopback hosts only", () => {
  for (const host of ["127.0.0.1", "127.1.2.3", "localhost", "::1", "[::1]"]) expect(isLoopbackHost(host)).toBe(true);
  for (const host of ["0.0.0.0", "::", "192.168.1.5", "example.com"]) expect(isLoopbackHost(host)).toBe(false);
  expect(connectHost("0.0.0.0")).toBe("127.0.0.1");
  expect(connectHost("::1")).toBe("[::1]");
});

it("prefers --data-dir, then A2A_DATA_DIR, then the home directory", () => {
  expect(resolveDataDir({ dataDir: "/a" }, { A2A_DATA_DIR: "/b" })).toBe("/a");
  expect(resolveDataDir({}, { A2A_DATA_DIR: "/b" })).toBe("/b");
  expect(resolveDataDir({}, {})).toMatch(/\.agent-taskbay$/);
});

it("generates vault keys once, keeps them private and never overwrites them", () => {
  const first = loadOrCreateSecrets(dir);
  expect(first.vaultKeys[first.vaultActiveKey]).toMatch(/^[0-9a-f]{64}$/);
  if (process.platform !== "win32") expect(statSync(join(dir, "secrets.json")).mode & 0o777).toBe(0o600);
  expect(loadOrCreateSecrets(dir)).toEqual(first);
  writeFileSync(join(dir, "secrets.json"), "{broken");
  expect(() => loadOrCreateSecrets(dir)).toThrow("not valid");
  expect(readFileSync(join(dir, "secrets.json"), "utf8")).toBe("{broken");
});

it("builds a local-mode environment without overriding operator settings", () => {
  const secrets = { vaultKeys: { "local-1": "a".repeat(64) }, vaultActiveKey: "local-1" };
  const env = buildEnvironment({ env: { A2A_AGUI_ENABLED: "true" }, port: 3002, host: "127.0.0.1", dataDir: dir, secrets });
  expect(env).toMatchObject({
    NODE_ENV: "production", PORT: "3002", HOSTNAME: "127.0.0.1", A2A_AUTH_MODE: "development", A2A_ALLOW_DEVELOPMENT_AUTH: "true",
    A2A_ALLOW_PRIVATE_NETWORKS: "true", A2A_AUTO_MIGRATE: "true", A2A_AGUI_ENABLED: "true",
    A2A_PGLITE_DATA_DIR: join(dir, "pglite"), A2A_ARTIFACT_DATA_DIR: join(dir, "artifacts"), A2A_VAULT_ACTIVE_KEY: "local-1",
  });
  expect(JSON.parse(env.A2A_VAULT_KEYS)).toEqual(secrets.vaultKeys);
  const custom = buildEnvironment({ env: { A2A_VAULT_KEYS: "{}", A2A_ALLOW_PRIVATE_NETWORKS: "false" }, port: 1, host: "localhost", dataDir: dir, secrets });
  expect(custom.A2A_VAULT_KEYS).toBe("{}");
  expect(custom.A2A_VAULT_ACTIVE_KEY).toBeUndefined();
  expect(custom.A2A_ALLOW_PRIVATE_NETWORKS).toBe("false");
});

it("refuses development identity on a non-loopback address", () => {
  const secrets = { vaultKeys: {}, vaultActiveKey: "x" };
  expect(() => buildEnvironment({ env: {}, port: 3002, host: "0.0.0.0", dataDir: dir, secrets })).toThrow("cannot listen on 0.0.0.0");
});

it("leaves authentication alone when OIDC is configured, and skips auto-migration for PostgreSQL", () => {
  const secrets = { vaultKeys: { k: "b".repeat(64) }, vaultActiveKey: "k" };
  const env = buildEnvironment({
    env: { A2A_AUTH_MODE: "oidc", A2A_DATABASE_PROFILE: "postgresql", A2A_DATABASE_URL: "postgresql://x/y" },
    port: 3002, host: "0.0.0.0", dataDir: dir, secrets,
  });
  expect(env.A2A_AUTH_MODE).toBe("oidc");
  expect(env.A2A_ALLOW_DEVELOPMENT_AUTH).toBeUndefined();
  expect(env.A2A_ALLOW_PRIVATE_NETWORKS).toBeUndefined();
  expect(env.A2A_AUTO_MIGRATE).toBeUndefined();
  expect(env.A2A_PGLITE_DATA_DIR).toBeUndefined();
});
