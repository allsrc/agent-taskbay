import { createCommandDispatcher } from "../runtime/commands";

/** Loop is shared by embedded local dispatch and the PostgreSQL worker. */
export function startCommandLoop() {
  const dispatcher = createCommandDispatcher();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  const tick = async () => {
    try {
      for (let count = 0; count < 10 && !stopped; count++) if (!await dispatcher.runOne()) break;
    } catch { console.error("Command dispatcher could not access durable state; will retry."); }
    if (!stopped) { timer = setTimeout(() => { running = tick(); }, 250); timer.unref?.(); }
  };
  running = tick();
  return async () => { stopped = true; clearTimeout(timer); await running; };
}

type WorkerGlobal = typeof globalThis & { __a2aCommandLoopStop?: () => Promise<void> };
export function startEmbeddedCommandLoop() {
  const state = globalThis as WorkerGlobal;
  state.__a2aCommandLoopStop ??= startCommandLoop();
}
