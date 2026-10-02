export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.A2A_COMMAND_WORKER_MODE === "external") {
    if ((process.env.A2A_DATABASE_PROFILE ?? "pglite") === "pglite") throw new Error("External command workers require PostgreSQL.");
    return;
  }
  if (process.env.A2A_COMMAND_WORKER_MODE && process.env.A2A_COMMAND_WORKER_MODE !== "embedded") throw new Error("Invalid A2A_COMMAND_WORKER_MODE.");
  const { startEmbeddedCommandLoop } = await import("./server/workers/command-loop");
  startEmbeddedCommandLoop();
}
