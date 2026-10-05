"use client";

import { use, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BackLink, Chip, EmptyState, InfoCard, StateChip } from "@/components/a2a/primitives";
import { TaskApprovals } from "@/components/approvals/task-approvals";
import { Button } from "@/components/ui/button";
import { conversationKey } from "@/lib/conversations";
import { runResubscribe } from "@/lib/run-message";
import { isActiveState, referencesOf, STATE_DOT, stateName, taskTitle } from "@/lib/task-view";
import { useServerResource } from "@/lib/use-server-resource";
import type { DurableTaskView } from "@/shared/task-types";
import { useTaskStore } from "@/store/task-store";
import { ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = use(params);
  const resource = useServerResource<{ task: DurableTaskView }>(`/api/tasks/${encodeURIComponent(taskId)}`);
  const task = resource.data?.task;
  const upsertTask = useTaskStore((state) => state.upsertTask);
  const [busy, setBusy] = useState<"subscribe" | "cancel" | null>(null);

  if (resource.loading) return <div className="p-6" role="status">Loading task…</div>;
  if (!task) {
    return (
      <EmptyState icon={<ListChecks className="size-7" />} title="Task not found">
        {resource.error ?? "This task is not available."}{" "}
        <Link href="/tasks" className="text-primary hover:underline">
          Back to tasks
        </Link>
      </EmptyState>
    );
  }

  const active = task.kind !== "message" && isActiveState(task.state);
  const references = referencesOf(task);

  async function subscribe() {
    if (!task) return;
    setBusy("subscribe");
    try {
      await runResubscribe(task, { onUpdate: () => resource.refresh() });
      toast.success("Stream ended", { description: "SubscribeToTask finished; the task is up to date." });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The agent doesn't support resubscribing.");
    } finally {
      resource.refresh();
      setBusy(null);
    }
  }

  async function cancel() {
    if (!task || !window.confirm("Cancel this task?")) return;
    setBusy("cancel");
    try {
      const response = await fetch(`/api/agents/${task.agentId}/tasks/${encodeURIComponent(task.taskId)}/cancel?tenant=${encodeURIComponent(task.tenant)}`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Failed to cancel the task.");
      const state = (body?.result as { status?: { state?: string } } | undefined)?.status?.state ?? "TASK_STATE_CANCELED";
      const timestamp = new Date().toISOString();
      upsertTask({ ...task, state, updatedAt: timestamp, transitions: [...(task.transitions ?? []), { state, timestamp }] });
      resource.refresh();
      toast.success("Task canceled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel the task.");
    } finally {
      resource.refresh();
      setBusy(null);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
      <BackLink href="/tasks">Tasks</BackLink>
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="min-w-40 flex-1 font-mono text-[22px] font-bold tracking-tight">{taskTitle(task, 80)}</h2>
        <StateChip state={task.state} />
      </div>
      <p className="text-muted-foreground mt-1 mb-4 font-mono text-xs">
        {task.taskId} · {task.contextId ?? "no context"} · {task.agentName}
      </p>

      {resource.error && <p role="alert" className="mb-3 text-sm text-brand">{resource.error}</p>}
      <div className="mb-5 flex flex-wrap gap-2">
        <Button variant="outline" onClick={resource.refresh}>Refresh</Button>
        <Button variant="brand" asChild>
          <Link href={`/chat/${conversationKey(task)}`} onClick={() => upsertTask(task)}>Open in chat</Link>
        </Button>
        <Button variant="outline" onClick={subscribe} disabled={!active || busy !== null} className="font-mono text-xs">
          {busy === "subscribe" && <Loader2 className="animate-spin" />} SubscribeToTask
        </Button>
        <Button variant="outline" onClick={cancel} disabled={!active || busy !== null} className="font-mono text-xs">
          {busy === "cancel" && <Loader2 className="animate-spin" />} CancelTask
        </Button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-3">
        <InfoCard label="Status timeline">
          {(task.transitions?.length ? task.transitions : [{ state: task.state, timestamp: task.updatedAt }]).map((item, index) => (
            <div key={`${item.state}-${index}`} className="flex items-baseline gap-2.5 py-1.5">
              <span className={cn("size-2 shrink-0 rounded-full", STATE_DOT[stateName(item.state)] ?? "bg-muted-foreground")} />
              <span className="flex-1 font-mono text-xs font-medium">{stateName(item.state)}</span>
              <span className="text-muted-foreground font-mono text-[11px]">{time(item.timestamp)}</span>
            </div>
          ))}
        </InfoCard>

        <InfoCard label="History">
          {task.messages.map((message) => {
            const text = message.parts.map((part) => (part.kind === "text" ? String(part.value) : `[${part.kind} · ${part.mediaType}]`)).join(" ");
            return (
              <div key={message.id} className="border-border border-t py-1.5 first:border-t-0">
                <div className={cn("font-mono text-[11px] font-medium", message.role === "user" ? "text-primary" : "text-brand")}>{message.role.toUpperCase()}</div>
                <div className="line-clamp-4 text-[13px] break-words whitespace-pre-wrap">{text}</div>
              </div>
            );
          })}
        </InfoCard>

        <InfoCard label="Artifacts">
          {task.artifacts.map((artifact) => (
            <div key={artifact.artifactId} className="flex items-center gap-2 py-1.5">
              <Chip>{artifact.parts[0]?.mediaType ?? "—"}</Chip>
              <span className="truncate font-mono text-[13px] font-medium">{artifact.name ?? artifact.artifactId}</span>
              {!artifact.complete && <span className="text-primary animate-pulse-soft font-mono text-[11px]">streaming</span>}
              {artifact.parts.filter((part) => part.kind === "url" && typeof part.value === "string" && /^\/api\/artifacts\/[0-9a-f]{64}$/.test(part.value)).map((part) => (
                <a key={part.id} href={String(part.value)} download={part.filename ?? "artifact"} className="text-primary text-xs underline">Download</a>
              ))}
            </div>
          ))}
          {task.artifacts.length === 0 && <p className="text-muted-foreground pt-1 text-[13px]">No artifacts yet.</p>}
        </InfoCard>

        {task.kind !== "message" && <TaskApprovals taskId={task.localId} canRequest={active} />}

        <InfoCard label="Identifiers">
          <dl className="flex flex-col gap-1.5 font-mono text-[11px]">
            {[
              ["localId", task.localId],
              ["taskId", task.taskId],
              ["tenant", task.tenant || "—"],
              ["contextId", task.contextId ?? "—"],
              ["messageIds", String(task.messages.length)],
              ["artifactIds", task.artifacts.map((artifact) => artifact.artifactId).join(", ") || "—"],
            ].map(([key, value]) => (
              <div key={key} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="truncate text-right">{value}</dd>
              </div>
            ))}
          </dl>
          {references.length > 0 && (
            <>
              <h4 className="label-mono mt-3 mb-1.5">referenceTaskIds</h4>
              <div className="flex flex-wrap gap-1.5">
                {references.map((id) => (
                  task.referenceLinks[id] ? <Link key={id} href={`/tasks/${task.referenceLinks[id]}`}>
                    <Chip>{id.slice(0, 8)}</Chip>
                  </Link> : <Chip key={id}>{id.slice(0, 8)}</Chip>
                ))}
              </div>
            </>
          )}
        </InfoCard>
      </div>
    </div>
  );
}
