import { createDecisionService } from "../runtime/decisions";

const interval = () => {
  const configured = Number(process.env.A2A_DECISION_SWEEP_MS);
  return Number.isFinite(configured) && configured >= 100 ? configured : 15_000;
};

/** Periodically expires/supersedes approvals and refreshes in-flight deliveries; every pass is idempotent. */
export function startDecisionLoop() {
  const service = createDecisionService();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  const tick = async () => {
    try { await service.sweep(); } catch { console.error("Decision sweeper could not access durable state; will retry."); }
    if (!stopped) { timer = setTimeout(() => { running = tick(); }, interval()); timer.unref?.(); }
  };
  running = tick();
  return async () => { stopped = true; clearTimeout(timer); await running; };
}

type WorkerGlobal = typeof globalThis & { __a2aDecisionLoopStop?: () => Promise<void> };
export function startEmbeddedDecisionLoop() {
  const state = globalThis as WorkerGlobal;
  state.__a2aDecisionLoopStop ??= startDecisionLoop();
}
