import { randomUUID } from "node:crypto";
import { createPushWorker } from "../runtime/push";
import { loadPushCredentials } from "../runtime/push-config";

export function startPushLoop() {
  const credentials = loadPushCredentials();
  if (!credentials) return async () => undefined;
  const worker = createPushWorker({ credentials });
  const shutdown = new AbortController();
  const loop = (async () => {
    let adopted = false;
    while (!shutdown.signal.aborted) {
      let worked = false;
      try {
        if (!adopted) { await worker.adopt(); adopted = true; }
        worked = await worker.runOne(randomUUID(), shutdown.signal);
      } catch { console.error("Push worker could not access durable state; will retry."); }
      if (!worked) await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); shutdown.signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, 500); timer.unref?.();
        shutdown.signal.addEventListener("abort", done, { once: true });
        if (shutdown.signal.aborted) done();
      });
    }
  })();
  return async () => { shutdown.abort(); await loop; };
}
type WorkerGlobal = typeof globalThis & { __a2aPushLoopStop?: () => Promise<void> };
export function startEmbeddedPushLoop() {
  const state = globalThis as WorkerGlobal;
  state.__a2aPushLoopStop ??= startPushLoop();
}
