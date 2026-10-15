"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { CommandError } from "@/components/a2a/command-error";
import { StateChip } from "@/components/a2a/primitives";
import { ResponsiveDialog } from "@/components/patterns/responsive-dialog";
import { Button } from "@/components/ui/button";
import { auditRelatedCancels, cancelCandidates, eligibleForCancel, initialCancelSelection, runRelatedCancels, type CancelCandidate, type CancelCounts, type CancelResults, type CancelWire } from "@/lib/cancel-related";
import type { DurableTaskView } from "@/shared/task-types";

/** Mount on opening so every run starts with current grants and terminal states. */
export function CancelTasksDialog({ taskId, selectRelated = false, onClose, onUpdated, onWire }: {
  taskId: string; selectRelated?: boolean; onClose: () => void; onUpdated: (task: DurableTaskView) => void; onWire?: CancelWire;
}) {
  const [tasks, setTasks] = useState<CancelCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<CancelResults>({});
  const [error, setError] = useState<string | null>(null);
  const [loadingAttempt, setLoadingAttempt] = useState(0);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<CancelCounts | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const runId = useRef<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let disposed = false;
    fetch(`/api/tasks/${encodeURIComponent(taskId)}`, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Could not load tasks to cancel. Try loading them again.");
      const body = await response.json();
      if (!disposed) { const candidates = cancelCandidates(body.task); setTasks(candidates); setSelected(initialCancelSelection(candidates, selectRelated)); setError(null); }
    }).catch(() => { if (!disposed) setError("Could not load tasks to cancel. Try loading them again."); });
    return () => { disposed = true; };
  }, [taskId, selectRelated, loadingAttempt]);

  async function saveSummary(counts: CancelCounts) {
    setAuditError(null);
    try { await auditRelatedCancels(taskId, runId.current!, counts); }
    catch (cause) { setAuditError(cause instanceof Error ? cause.message : "Could not record the cancel summary."); }
  }
  async function confirm() {
    if (inFlight.current || summary || !tasks || !selected.size) return;
    inFlight.current = true; setRunning(true); runId.current = crypto.randomUUID();
    try {
      const counts = await runRelatedCancels(tasks, selected, runId.current, setResults, (updated) => {
        setTasks((previous) => previous?.map((candidate) => candidate.localId === updated.localId ? {
          ...candidate, state: updated.state, canOperate: updated.canOperate === true, cancelable: updated.cancelable === true,
        } : candidate) ?? null);
        onUpdated(updated);
      }, onWire);
      setSummary(counts);
      await saveSummary(counts);
      if (counts.canceled) toast.success(`${counts.canceled} ${counts.canceled === 1 ? "task canceled" : "tasks canceled"}`);
      if (counts.refused || counts.failed) toast.error("Some tasks could not be canceled. Review each result.");
    } finally { inFlight.current = false; setRunning(false); }
  }
  return <ResponsiveDialog open onOpenChange={(open) => { if (!open && !inFlight.current) onClose(); }}
    title="Cancel this task and related tasks" description="Taskbay cancels each one separately. The agent decides whether it stops."
    footer={<>
      <Button variant="outline" disabled={running} onClick={onClose}>{summary ? "Close" : "Back"}</Button>
      {!summary && <Button variant="destructive" disabled={running || !tasks || !selected.size} onClick={() => void confirm()}>
        {running && <Loader2 className="animate-spin" />} Cancel {selected.size} {selected.size === 1 ? "task" : "tasks"}
      </Button>}
    </>}>
    {error ? <div role="alert" className="space-y-2 text-sm"><p>{error}</p><Button variant="outline" onClick={() => { setError(null); setLoadingAttempt((value) => value + 1); }}>Load tasks again</Button></div>
      : !tasks ? <p role="status" className="text-sm text-muted-foreground">Loading tasks…</p> : <>
        <ul className="max-h-[50dvh] space-y-3 overflow-y-auto" aria-label="Tasks to cancel">
          {tasks.map((task) => {
            const result = results[task.localId];
            return <li key={task.localId} className="min-w-0 space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 shrink-0 accent-current" checked={selected.has(task.localId)} disabled={running || !!summary || !eligibleForCancel(task)}
                  onChange={(event) => { const checked = event.target.checked; setSelected((previous) => { const next = new Set(previous); if (checked) next.add(task.localId); else next.delete(task.localId); return next; }); }} />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{task.title || `Task ${task.taskId.slice(0, 8)}`}{task.current ? " (this task)" : ""}
                  {!task.canOperate && <span className="block text-xs text-muted-foreground">You can&apos;t cancel this task (needs someone with access)</span>}
                  {task.canOperate && !task.cancelable && <span className="block text-xs text-muted-foreground">This task is finished.</span>}
                </span>
                <StateChip state={task.state} />
              </label>
              {result && <div role="status" className="space-y-1 text-sm">
                <p>{result.status === "running" ? "Canceling…" : result.status === "canceled" ? "Canceled" : result.status === "refused" ? (result.failure?.kind === "task_not_cancelable" ? "Agent refused: not cancelable" : "Cancel refused") : "Failed"}</p>
                {result.failure && <CommandError failure={result.failure} />}
              </div>}
            </li>;
          })}
        </ul>
        {!tasks.some(eligibleForCancel) && <p className="text-sm text-muted-foreground">No tasks you can cancel. Close this dialog and check the tasks&apos; states or ask someone with access.</p>}
      </>}
    {summary && <p role="status" className="text-sm">{summary.requested} requested · {summary.canceled} canceled · {summary.refused} refused · {summary.failed} failed</p>}
    {auditError && <div role="alert" className="space-y-2 text-sm"><p>{auditError}</p><Button disabled={running} variant="outline" onClick={async () => { if (!summary || inFlight.current) return; inFlight.current = true; setRunning(true); try { await saveSummary(summary); } finally { inFlight.current = false; setRunning(false); } }}>Save summary again</Button></div>}
  </ResponsiveDialog>;
}
