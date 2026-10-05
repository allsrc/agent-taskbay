import nextEnvironment from "@next/env";
nextEnvironment.loadEnvConfig(process.cwd());
if (process.env.A2A_DATABASE_PROFILE !== "postgresql") throw new Error("The separate worker requires PostgreSQL; PGlite uses embedded dispatch.");
const { startCommandLoop } = await import("../src/server/workers/command-loop");
const { startSubscriptionLoop } = await import("../src/server/workers/subscription-loop");
const { closeDatabaseOrm } = await import("../src/server/adapters/db/orm");
const stop = startCommandLoop();
const stopSubscriptions = startSubscriptionLoop();
const { startPushLoop } = await import("../src/server/workers/push-loop");
const stopPush = startPushLoop();
const { startReconciliationLoop } = await import("../src/server/workers/reconciliation-loop");
const stopReconciliation = startReconciliationLoop();
const { startFreshnessLoop } = await import("../src/server/workers/freshness-loop");
const stopFreshness = startFreshnessLoop();
const { startDecisionLoop } = await import("../src/server/workers/decision-loop");
const stopDecisions = startDecisionLoop();
// Keep this entry point alive even while its polling timer is idle.
const keepAlive = setInterval(() => undefined, 60_000);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await Promise.all([stop(), stopSubscriptions(), stopPush(), stopReconciliation(), stopFreshness(), stopDecisions()]); await closeDatabaseOrm(); clearInterval(keepAlive);
}
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
