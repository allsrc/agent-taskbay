"use client";

import { useState } from "react";
import { History, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { CommandError } from "@/components/a2a/command-error";
import { Button } from "@/components/ui/button";
import { CommandFailureError, failureFromError, failureFromResponse, type CommandFailure } from "@/lib/command-failure";
import type { DurableTaskView, ThreadMessage, TrackedTask } from "@/shared/task-types";

/** Splits a task's messages into what Taskbay received and what only the agent's loaded history carried. */
export function splitAgentHistory(messages: ThreadMessage[]): { received: ThreadMessage[]; history: ThreadMessage[] } {
  return { received: messages.filter((message) => message.origin !== "agent-history"), history: messages.filter((message) => message.origin === "agent-history") };
}

/** Whether the agent can be asked for history: only a task with an id on the agent, not a direct message. */
export const canLoadAgentHistory = (task: Pick<TrackedTask, "kind" | "localId" | "taskId">) => task.kind !== "message" && Boolean(task.localId) && Boolean(task.taskId);

export function AgentHistoryDivider({ children }: { children: string }) {
  return (
    <div role="separator" aria-label={children} className="text-muted-foreground flex items-center gap-3 text-xs font-medium">
      <span className="bg-border h-px flex-1" aria-hidden />
      <span>{children}</span>
      <span className="bg-border h-px flex-1" aria-hidden />
    </div>
  );
}

export const AGENT_HISTORY_NOTE = "The agent chooses what history to keep. It may be incomplete.";

/** Ghost button that asks the agent for the history it keeps for this task and hands back the stored result. */
export function LoadAgentHistoryButton({ task, onLoaded, className }: { task: Pick<TrackedTask, "kind" | "localId" | "taskId">; onLoaded: (task: DurableTaskView) => void; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<CommandFailure | null>(null);
  if (!canLoadAgentHistory(task)) return null;

  async function load() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/tasks/${task.localId}/history/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) {
        const refusal = await failureFromResponse(response, "Could not load the agent's history.");
        throw new CommandFailureError(refusal.message, refusal);
      }
      const body = (await response.json()) as { task: DurableTaskView; added: number };
      onLoaded(body.task);
      toast.success(body.added ? `Loaded ${body.added} ${body.added === 1 ? "message" : "messages"} from the agent's history` : "The agent's history had nothing new");
    } catch (cause) {
      setFailure(failureFromError(cause, "Could not load the agent's history."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="text-muted-foreground h-7 px-2 text-xs" onClick={() => void load()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <History />} Load agent history
        </Button>
      </div>
      {failure && <CommandError failure={failure} className="mt-2" onRetry={() => void load()} />}
    </div>
  );
}
