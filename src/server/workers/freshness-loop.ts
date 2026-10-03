import { createFreshnessDispatcher } from "../runtime/freshness";

export function startFreshnessLoop() {
  const dispatcher = createFreshnessDispatcher();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  const tick = async () => {
    try {
      for (let count = 0; count < 100 && !stopped; count++) if (!await dispatcher.runOne()) break;
    } catch { console.error("Freshness dispatcher could not access durable state; will retry."); }
    if (!stopped) { timer = setTimeout(() => { running = tick(); }, 250); timer.unref?.(); }
  };
  running = tick();
  return async () => { stopped = true; clearTimeout(timer); await running; };
}

type WorkerGlobal = typeof globalThis & { __a2aFreshnessLoopStop?: () => Promise<void> };
export function startEmbeddedFreshnessLoop() {
  const state = globalThis as WorkerGlobal;
  state.__a2aFreshnessLoopStop ??= startFreshnessLoop();
}
