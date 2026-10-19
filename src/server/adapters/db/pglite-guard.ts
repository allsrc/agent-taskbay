import { readFileSync, rmSync, writeFileSync } from "node:fs";

/**
 * A refusal to open the embedded database, with text a person can act on. It is the only database error the workers
 * and the console repeat; anything else is reported by its name alone, because driver messages can carry connection details.
 */
export class DatabaseOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseOpenError";
  }
}

const held = new Set<string>();

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

export const lockPathFor = (dataDir: string) => `${dataDir}.lock`;

/**
 * PGlite is a single-owner database with no lock of its own: a second process that opens the same folder succeeds, and
 * both then write to it, which damages it. This takes a lock file beside the folder (never inside it) and refuses while
 * another live process holds it. A lock left by a process that died is taken over. Held until this process exits.
 */
export function claimPgliteDirectory(dataDir: string): void {
  if (held.has(dataDir)) return;
  const file = lockPathFor(dataDir);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, { flag: "wx" });
      held.add(dataDir);
      process.once("exit", () => { try { rmSync(file); } catch { /* already gone */ } });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return; // an unwritable location is reported by the database itself
      let owner: number | undefined;
      try { owner = (JSON.parse(readFileSync(file, "utf8")) as { pid?: number }).pid; } catch { /* unreadable: treat as stale */ }
      if (owner === process.pid) { held.add(dataDir); return; }
      if (owner !== undefined && alive(owner)) {
        throw new DatabaseOpenError(
          `The embedded database in ${dataDir} is already open in another process (pid ${owner}). ` +
          "Stop that process first (for example the dev server, the launcher, or a migration), then try again. " +
          "Opening it twice damages it. If nothing of yours is running (an operating system can give a dead process's number " +
          `to an unrelated one), delete ${file} and try again.`);
      }
      rmSync(file, { force: true }); // stale: its owner is gone
    }
  }
}

/**
 * PGlite reports an unreadable folder by throwing `RuntimeError: Aborted()` from inside its WebAssembly, which escapes as an
 * uncaught exception and ends the whole process instead of rejecting the open. Catch that for the duration of the open and
 * turn it into an error that says what happened and what to do.
 */
export async function openGuarded<T>(dataDir: string, open: () => Promise<T>): Promise<T> {
  let fail!: (error: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { fail = reject; });
  const onUncaught = (error: unknown) => {
    if (error instanceof Error && /Aborted\(\)/.test(error.message)) {
      fail(new DatabaseOpenError(
        `The embedded database in ${dataDir} could not be opened (PGlite aborted). It is usually damaged by a process killed ` +
        "while writing, or opened by two processes at once. Stop everything that uses it. If it still fails, move the folder " +
        "aside (it holds your data) and start again to get a fresh one."));
    } else {
      process.removeListener("uncaughtException", onUncaught);
      throw error;
    }
  };
  process.on("uncaughtException", onUncaught);
  try {
    const opening = open();
    opening.catch(() => undefined); // if the abort wins the race, a later rejection is not an unhandled one
    return await Promise.race([opening, aborted]);
  } finally {
    process.removeListener("uncaughtException", onUncaught);
  }
}
