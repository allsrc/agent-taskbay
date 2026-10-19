import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claimPgliteDirectory, DatabaseOpenError, lockPathFor } from "./pglite-guard";

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "a2a-guard-"));
  return { dir, dataDir: join(dir, "db"), done: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Runs one script in a separate process; the open that aborts would end this test process. */
function run(code: string, dataDir: string) {
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
    cwd: process.cwd(), env: { ...process.env, A2A_PGLITE_DATA_DIR: dataDir, A2A_DATABASE_PROFILE: "pglite" }, encoding: "utf8", timeout: 90_000,
  });
}

describe("PGlite directory lock", () => {
  it("refuses a live owner, takes over a dead one's lock and ignores an unreadable one", () => {
    const { dataDir, dir, done } = scratch();
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(lockPathFor(dataDir), JSON.stringify({ pid: process.ppid }));
      expect(() => claimPgliteDirectory(dataDir)).toThrow(DatabaseOpenError);
      expect(() => claimPgliteDirectory(dataDir)).toThrow(/already open in another process/);
      writeFileSync(lockPathFor(dataDir), JSON.stringify({ pid: 2 ** 22 + 7 }));
      claimPgliteDirectory(dataDir);
      claimPgliteDirectory(dataDir); // the same process may claim again
      const other = scratch();
      writeFileSync(lockPathFor(other.dataDir), "not json");
      claimPgliteDirectory(other.dataDir);
      other.done();
    } finally { done(); }
  });
});

describe("PGlite open failures", () => {
  it("a second process is refused with a clear message instead of sharing the folder", () => {
    const { dataDir, done } = scratch();
    try {
      const script = `
        import { createDatabaseOrm } from "./src/server/adapters/db/orm";
        const a = await createDatabaseOrm();
        const { spawnSync } = await import("node:child_process");
        const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
          'import { createDatabaseOrm } from "./src/server/adapters/db/orm"; try { await createDatabaseOrm(); console.log("OPENED"); } catch (e) { console.log(e.name + ": " + e.message); } process.exit(0);'],
          { encoding: "utf8", env: process.env });
        console.log(child.stdout);
        await a.close(true); process.exit(0);`;
      const result = run(script, dataDir);
      expect(result.stdout).toContain("DatabaseOpenError: The embedded database");
      expect(result.stdout).toContain("already open in another process");
      expect(result.stdout).not.toContain("OPENED");
    } finally { done(); }
  }, 120_000);

  it("an Aborted() thrown from inside PGlite becomes a clear error, not a crash of the whole process", () => {
    const { dataDir, done } = scratch();
    try {
      // PGlite's WebAssembly throws this from a callback, so it is uncaught rather than a rejection of the open.
      const result = run(`
        import { openGuarded } from "./src/server/adapters/db/pglite-guard";
        const dir = process.env.A2A_PGLITE_DATA_DIR;
        try { await openGuarded(dir, () => new Promise(() => setTimeout(() => { throw new Error("Aborted(). Build with -sASSERTIONS for more info."); }, 20))); console.log("OPENED"); }
        catch (e) { console.log(e.name + ": " + e.message); }
        try { await openGuarded(dir, async () => { setTimeout(() => { throw new Error("something else"); }, 20); await new Promise((r) => setTimeout(r, 200)); }); console.log("SWALLOWED"); }
        catch (e) { console.log("unexpected " + e.message); }`, dataDir);
      expect(result.stdout).toContain("DatabaseOpenError: The embedded database");
      expect(result.stdout).toContain("could not be opened");
      expect(result.stdout).toContain("move the folder aside");
      // An unrelated uncaught error must still end the process; the guard only claims the abort.
      expect(result.stdout).not.toContain("SWALLOWED");
      expect(result.status).not.toBe(0);
    } finally { done(); }
  }, 120_000);
});
