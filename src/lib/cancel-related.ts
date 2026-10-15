import type { DurableTaskView, RelatedTask } from "@/shared/task-types";
import { CommandFailureError, failureFromError, failureFromResponse, type CommandFailure } from "./command-failure";

export type CancelCandidate = RelatedTask & { current?: boolean };
export type CancelResult = { status: "running" | "canceled" | "refused" | "failed"; failure?: CommandFailure };
export type CancelResults = Record<string, CancelResult>;
export type CancelWire = (direction: "in" | "out", kind: string, data: unknown) => void;
export interface CancelCounts { requested: number; canceled: number; refused: number; failed: number }

export function cancelCandidates(task: DurableTaskView): CancelCandidate[] {
  const current: CancelCandidate = { localId: task.localId, taskId: task.taskId, agentId: task.agentId, tenant: task.tenant,
    agentName: task.agentName, state: task.state, title: task.title, canOperate: task.canOperate === true, cancelable: task.cancelable === true, current: true };
  const seen = new Set([task.localId]);
  return [current, ...[...(task.related?.references ?? []), ...(task.related?.referencedBy ?? [])].filter((item) => !seen.has(item.localId) && seen.add(item.localId))];
}
export const eligibleForCancel = (task: CancelCandidate) => task.canOperate && task.cancelable;
export const initialCancelSelection = (tasks: CancelCandidate[], all: boolean) => new Set(tasks.filter((task) => eligibleForCancel(task) && (all || task.current)).map((task) => task.localId));

/** Each selected task is a separate idempotent command. A refusal or unknown result never stops the remaining selections. */
export async function runRelatedCancels(tasks: CancelCandidate[], selected: Set<string>, runId: string, onProgress: (results: CancelResults) => void,
  onUpdated: (task: DurableTaskView) => void = () => {}, onWire?: CancelWire) {
  const results: CancelResults = {};
  const counts: CancelCounts = { requested: 0, canceled: 0, refused: 0, failed: 0 };
  for (const task of tasks.filter((item) => selected.has(item.localId) && eligibleForCancel(item))) {
    counts.requested++;
    results[task.localId] = { status: "running" }; onProgress({ ...results });
    try {
      onWire?.("out", "CancelTask", { method: "CancelTask", params: { id: task.taskId, tenant: task.tenant } });
      const response = await fetch(`/api/agents/${encodeURIComponent(task.agentId)}/tasks/${encodeURIComponent(task.taskId)}/cancel?tenant=${encodeURIComponent(task.tenant)}`,
        { method: "POST", headers: { "Idempotency-Key": `cancel-related:${runId}:${task.localId}` } });
      if (!response.ok) {
        const failure = await failureFromResponse(response, "Failed to cancel the task.");
        throw new CommandFailureError(failure.message, failure);
      }
      const body = await response.json();
      onWire?.("in", "task", body.result);
      if (body?.result?.status?.state?.replace("TASK_STATE_", "") !== "CANCELED")
        throw new CommandFailureError("The agent accepted the request, but did not return a canceled task. Check its state before trying again.", { kind: "uncertain" });
      results[task.localId] = { status: "canceled" }; counts.canceled++;
    } catch (cause) {
      const parsed = failureFromError(cause, "Failed to cancel the task.");
      const failure = cause instanceof CommandFailureError ? parsed : { ...parsed, kind: "uncertain" };
      const refused = (failure.kind !== undefined && failure.kind !== "uncertain") || failure.status === 403;
      results[task.localId] = { status: refused ? "refused" : "failed", failure };
      if (refused) counts.refused++; else counts.failed++;
    }
    onProgress({ ...results });
    // Read committed state after success or refusal. A failed refresh does not change the command's outcome.
    await fetch(`/api/tasks/${encodeURIComponent(task.localId)}`, { cache: "no-store" }).then(async (response) => {
      if (response.ok) { const body = await response.json(); if (body.task) onUpdated(body.task); }
    }).catch(() => {});
  }
  return counts;
}

/** Retrying this summary uses the same run ID; it never repeats any cancel. */
export async function auditRelatedCancels(taskId: string, runId: string, counts: CancelCounts) {
  const message = "Could not record the cancel summary. Retry saving the summary; completed cancels will not be repeated.";
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/workflow/cancel-related/audit`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, ...counts }),
  }).catch(() => { throw new Error(message); });
  if (!response.ok) throw new Error(message);
}
