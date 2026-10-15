import type { JsonValue, SyncCursorRecord } from "../../domain/persistence-model";
import { eventSubject, object } from "./task-projection";

/** Limits of automatic discovery (plan decision D-12): constants, documented, not configurable. */
export const FIRST_SWEEP_LIMIT = 500;
export const SWEEP_LIMIT = 200;
export const AGENT_LIMIT = 5000;
export const FULL_SWEEP_EVERY_MS = 60 * 60 * 1000;
/** Allowance for clocks that disagree when asking an agent only for what changed. */
export const SKEW_MS = 5 * 60 * 1000;
export const DISCOVERED_HISTORY_PAGE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const STATES = ["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING", "TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED", "TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"];
const TERMINAL = ["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"];

/** A sweep reads everything at least once an hour, and in between asks only for tasks that changed since the last one. */
export function planSweep(cursor: Pick<SyncCursorRecord, "lastFullSweepAt" | "lastSyncedAt">, now: Date): { full: boolean; after: Date | null } {
  const lastFull = cursor.lastFullSweepAt ?? null;
  if (!lastFull || now.getTime() - lastFull.getTime() >= FULL_SWEEP_EVERY_MS || !cursor.lastSyncedAt) return { full: true, after: null };
  return { full: false, after: new Date(cursor.lastSyncedAt.getTime() - SKEW_MS) };
}

export type DiscoveryVerdict =
  | { store: true }
  | { store: false; reason: "invalid" | "history" | "sweep_limit" | "agent_limit" };

/** Whether a task found on the agent is stored by automatic discovery. Pure: the caller supplies the counts. */
export function judgeDiscovered(event: JsonValue, context: { tenant: string; now: Date; historyDays: number; sweepFound: number; sweepLimit: number; total: number }): DiscoveryVerdict {
  const { kind, subject, remoteTaskId } = eventSubject(event);
  const status = object(subject.status);
  if (kind !== "task" || !remoteTaskId || remoteTaskId.length > 512 || typeof status.state !== "string" || !STATES.includes(status.state)) return { store: false, reason: "invalid" };
  if (subject.tenant !== undefined && subject.tenant !== context.tenant) return { store: false, reason: "invalid" };
  if (TERMINAL.includes(status.state)) {
    // Only recent history: a finished task whose time cannot be shown to be inside the window is left on the agent.
    const at = typeof status.timestamp === "string" ? Date.parse(status.timestamp) : NaN;
    if (!Number.isFinite(at) || context.historyDays <= 0 || context.now.getTime() - at > context.historyDays * DAY_MS) return { store: false, reason: "history" };
  }
  if (context.total >= AGENT_LIMIT) return { store: false, reason: "agent_limit" };
  if (context.sweepFound >= context.sweepLimit) return { store: false, reason: "sweep_limit" };
  return { store: true };
}
