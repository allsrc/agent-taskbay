"use client";

import { Check, Circle, Loader2, X } from "lucide-react";
import { CommandError } from "@/components/a2a/command-error";
import { ResponsiveDialog } from "@/components/patterns/responsive-dialog";
import { Button } from "@/components/ui/button";
import type { RestartProgress, StepStatus } from "@/lib/restart-task";

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "running") return <Loader2 className="size-4 animate-spin" aria-hidden="true" />;
  if (status === "done") return <Check className="text-success size-4" aria-hidden="true" />;
  if (status === "failed") return <X className="text-danger size-4" aria-hidden="true" />;
  return <Circle className="text-muted-foreground size-4" aria-hidden="true" />;
}
const STATUS_TEXT: Record<StepStatus, string> = { waiting: "Not started", running: "Working", done: "Done", failed: "Failed", skipped: "Not run" };

/** The two steps, their results and what to do when one fails. Separate from the dialog frame so it can be rendered on its own. */
export function RestartSteps({ taskTitle, progress, onSendAsInput, onRetryStart, onStartNew }: {
  taskTitle: string;
  progress: RestartProgress;
  /** Offered when step 1 was refused or its outcome is unknown: send the same text as ordinary extra input. */
  onSendAsInput?: () => void;
  /** Offered when step 2 failed after step 1 succeeded. Retries step 2 only. */
  onRetryStart?: () => void;
  onStartNew?: () => void;
}) {
  const cancelFailed = progress.cancel.status === "failed";
  const startFailed = progress.start.status === "failed";
  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="restart-steps">
      <ol className="flex flex-col gap-2">
        <li className="flex items-start gap-2" data-step="cancel" data-status={progress.cancel.status}>
          <StepIcon status={progress.cancel.status} />
          <span className="min-w-0 flex-1">
            1. Cancel &ldquo;{taskTitle}&rdquo; <span className="text-muted-foreground">(the agent decides whether it stops)</span>
            <span className="text-muted-foreground block text-xs">
              {progress.cancel.alreadyFinished ? "The task had already finished." : STATUS_TEXT[progress.cancel.status]}
            </span>
          </span>
        </li>
        <li className="flex items-start gap-2" data-step="start" data-status={progress.start.status}>
          <StepIcon status={progress.start.status} />
          <span className="min-w-0 flex-1">
            2. Start a new task in this conversation with your instruction, referencing the old one.
            <span className="text-muted-foreground block text-xs">{STATUS_TEXT[progress.start.status]}</span>
          </span>
        </li>
      </ol>
      <p className="text-muted-foreground text-xs">Partial work may or may not be kept. Taskbay cannot tell.</p>
      {cancelFailed && progress.cancel.failure && (
        <>
          <CommandError failure={progress.cancel.failure} />
          <p className="text-xs">The new task was not started and nothing else changed.</p>
          {onSendAsInput && <div><Button size="sm" variant="outline" onClick={onSendAsInput}>Send as extra input instead</Button></div>}
        </>
      )}
      {startFailed && progress.start.failure && (
        <>
          <p className="text-xs font-medium">{progress.start.failure.kind === "uncertain" || !progress.start.failure.kind
            ? "The old task has finished. Taskbay cannot confirm whether the new task started."
            : "The old task was canceled, but the new task was not started."}</p>
          <CommandError failure={progress.start.failure} onStartNew={onStartNew} />
          {onRetryStart && <div><Button size="sm" variant="outline" onClick={onRetryStart}>{progress.start.failure.kind === "uncertain" || !progress.start.failure.kind ? "Check step 2 again" : "Try step 2 again"}</Button></div>}
        </>
      )}
    </div>
  );
}

export function RestartDialog({ open, onOpenChange, ...steps }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  progress: RestartProgress;
  taskTitle: string;
  onConfirm: () => void;
  onSendAsInput?: () => void;
  onRetryStart?: () => void;
}) {
  const { progress, onConfirm } = steps;
  const running = progress.cancel.status === "running" || progress.start.status === "running";
  const finished = progress.start.status === "done";
  const retryable = progress.cancel.status === "waiting" || progress.cancel.status === "failed";
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => { if (!running) onOpenChange(next); }}
      title="Stop and restart with this instruction"
      footer={
        <>
          <Button variant="outline" disabled={running} onClick={() => onOpenChange(false)}>{finished ? "Close" : "Back"}</Button>
          {!finished && retryable && <Button disabled={running} onClick={onConfirm}>Cancel task, then start</Button>}
        </>
      }
    >
      <RestartSteps taskTitle={steps.taskTitle} progress={progress} onSendAsInput={steps.onSendAsInput} onRetryStart={steps.onRetryStart} />
    </ResponsiveDialog>
  );
}
