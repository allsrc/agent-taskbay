import nextEnvironment from "@next/env";
nextEnvironment.loadEnvConfig(process.cwd());
if (process.env.A2A_DATABASE_PROFILE !== "postgresql") throw new Error("The separate worker requires PostgreSQL; PGlite uses embedded dispatch.");
const { startCommandLoop } = await import("../src/server/workers/command-loop");
const { closeDatabaseOrm } = await import("../src/server/adapters/db/orm");
const stop = startCommandLoop();
// Keep this entry point alive even while its polling timer is idle.
const keepAlive = setInterval(() => undefined, 60_000);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await stop(); await closeDatabaseOrm(); clearInterval(keepAlive);
}
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
