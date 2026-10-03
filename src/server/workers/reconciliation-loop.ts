import { randomUUID } from "node:crypto";
import { createReconciliationWorker } from "../runtime/reconciliation";

export function startReconciliationLoop(concurrency = 2) {
  const worker = createReconciliationWorker();
  const shutdown = new AbortController();
  const loops = Array.from({ length: concurrency }, async () => {
    while (!shutdown.signal.aborted) {
      let worked = false;
      try { worked = await worker.runOne(randomUUID(), shutdown.signal); }
      catch { console.error("Reconciliation worker could not access durable state; will retry."); }
      if (!worked) await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); shutdown.signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, 250); timer.unref?.();
        shutdown.signal.addEventListener("abort", done, { once: true });
        if (shutdown.signal.aborted) done();
      });
    }
  });
  return async () => { shutdown.abort(); await Promise.all(loops); };
}
type WorkerGlobal = typeof globalThis & { __a2aReconciliationLoopStop?: () => Promise<void> };
export function startEmbeddedReconciliationLoop() {
  const state = globalThis as WorkerGlobal;
  state.__a2aReconciliationLoopStop ??= startReconciliationLoop();
}
