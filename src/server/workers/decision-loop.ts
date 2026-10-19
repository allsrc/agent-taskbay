import { createDecisionService } from "../runtime/decisions";
import { createWorkflowService } from "../runtime/workflow";
import { reportRetry } from "./report";

const interval = () => {
  const configured = Number(process.env.A2A_DECISION_SWEEP_MS);
  return Number.isFinite(configured) && configured >= 100 ? configured : 15_000;
};

/**
 * Periodically expires/supersedes approvals, refreshes in-flight deliveries and escalates overdue task ownership.
 * Every pass is idempotent and each step fails independently.
 */
export function startDecisionLoop() {
  const service = createDecisionService();
  const workflow = createWorkflowService();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  const tick = async () => {
    try { await service.sweep(); } catch (error) { reportRetry("Decision sweeper", error); }
    try { await workflow.sweepEscalations(); } catch (error) { reportRetry("Escalation sweeper", error); }
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
