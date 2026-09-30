"use client";

import { useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, KeyRound, Loader2, MessageSquare, Plus, Send, UserRound, Workflow } from "lucide-react";
import { toast } from "sonner";
import { runResubscribe, runSend, userThreadMessage } from "@/lib/run-message";
import { BUCKET_BADGE, taskBucket, useTaskStore, type TaskBucket } from "@/store/task-store";
import { useShallow } from "zustand/react/shallow";
import { PartRenderer } from "@/components/PartRenderer";
import { ArtifactGallery } from "@/components/ArtifactGallery";
import { IdentifiersPanel } from "@/components/IdentifiersPanel";
import { MessageComposer, type ComposerSubmit } from "@/components/MessageComposer";
import { stateLabel, TaskLifecycle } from "@/components/TaskLifecycle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** A task in one of these buckets is terminal (A2A spec: completed/failed/canceled/rejected can't accept new messages). */
const TERMINAL_BUCKETS: TaskBucket[] = ["completed", "failed"];

export default function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = use(params);
  const router = useRouter();
  const task = useTaskStore((state) => state.tasks[taskId]);
  const upsertTask = useTaskStore((state) => state.upsertTask);
  const allTasks = useTaskStore(useShallow((state) => Object.values(state.tasks)));
  const [sending, setSending] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resubscribedRef = useRef<string | null>(null);

  const isReply = task?.kind === "message";
  const bucket = task ? taskBucket(task.state) : "in-progress";
  const isTerminal = TERMINAL_BUCKETS.includes(bucket);
  const needsInput = bucket === "needs-input";
  const cancelable = !isReply && !isTerminal;

  // Reconnect to a still-running task's live stream on open (A2A `SubscribeToTask`)
  // so a reopened tab reflects what the agent did while it was closed.
  // Best-effort: not every agent/transport supports it, so failures are silent.
  useEffect(() => {
    if (!task || isReply || isTerminal || resubscribedRef.current === task.taskId) return;
    resubscribedRef.current = task.taskId;
    runResubscribe(task, { onUpdate: upsertTask }).catch((resubscribeError) => {
      console.warn("Resubscribe failed (agent may not support streaming resubscription):", resubscribeError);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.taskId]);

  if (!task) {
    return (
      <Card className="items-center border-dashed py-14 text-center">
        <CardContent className="flex flex-col items-center gap-3">
          <Workflow className="text-primary size-7" />
          <p className="font-medium">Task not found</p>
          <p className="text-muted-foreground max-w-md text-sm">
            This task isn&apos;t in this browser&apos;s local state. Open it from the{" "}
            <a href="/inbox" className="text-primary hover:underline">
              inbox
            </a>{" "}
            that started it.
          </p>
        </CardContent>
      </Card>
    );
  }

  const contextSiblings = allTasks
    .filter((candidate) => candidate.taskId !== task.taskId && candidate.contextId && candidate.contextId === task.contextId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const referenceableTasks = allTasks
    .filter((candidate) => candidate.kind !== "message" && candidate.taskId !== task.taskId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 12)
    .map((candidate) => ({ taskId: candidate.taskId, label: `${candidate.agentName} · ${candidate.taskId.slice(0, 8)}` }));

  const prompt = needsInput ? [...task.messages].reverse().find((message) => message.role === "agent") : undefined;

  async function cancelTask() {
    if (!task || canceling || !window.confirm("Cancel this task?")) return;
    setCanceling(true);
    try {
      const response = await fetch(`/api/agents/${task.agentId}/tasks/${task.taskId}/cancel`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Failed to cancel the task.");
      const state = (body?.result as { status?: { state?: string } } | undefined)?.status?.state ?? "TASK_STATE_CANCELED";
      upsertTask({
        ...task,
        state,
        updatedAt: new Date().toISOString(),
        transitions: [...(task.transitions ?? []), { state, timestamp: new Date().toISOString() }],
      });
      toast.success("Task canceled");
    } catch (cancelError) {
      toast.error(cancelError instanceof Error ? cancelError.message : "Failed to cancel the task.");
    } finally {
      setCanceling(false);
    }
  }

  /**
   * Open task / needs-input: continue the *same* `taskId`.
   * Terminal task or direct-reply thread: send inside the same `contextId`
   * without a `taskId`, which the agent answers as a new Message or a new Task.
   */
  async function submit({ parts, config }: ComposerSubmit) {
    if (!task || sending) return;
    const continuing = !isReply && !isTerminal;
    setSending(true);
    setError(null);
    const userMessage = userThreadMessage(parts, { contextId: task.contextId, taskId: continuing ? task.taskId : undefined }, config);
    const base = continuing || isReply ? { ...task, messages: [...task.messages, userMessage], updatedAt: userMessage.timestamp } : undefined;
    if (base) upsertTask(base);
    let landedOn: string | undefined;
    try {
      await runSend(
        {
          agentId: task.agentId,
          agentName: task.agentName,
          parts,
          taskId: continuing ? task.taskId : undefined,
          contextId: task.contextId,
          config,
          userMessage,
          base,
        },
        {
          onUpdate: (next) => {
            landedOn = next.taskId;
            upsertTask(next);
          },
          onError: setError,
        },
      );
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to send the message.");
    } finally {
      setSending(false);
      if (landedOn && landedOn !== task.taskId) router.push(`/tasks/${landedOn}`);
    }
  }

  const headline = isReply ? "Direct reply" : task.taskId;

  return (
    <section className="flex flex-col gap-4">
      <header className="border-border bg-card flex items-center justify-between gap-4 rounded-xl border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {isReply ? <MessageSquare className="text-primary size-4 shrink-0" /> : <Workflow className="text-primary size-4 shrink-0" />}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{task.agentName}</p>
            <p className="text-muted-foreground truncate font-mono text-[11px]">{headline}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {cancelable && (
            <Button variant="outline" size="sm" onClick={cancelTask} disabled={canceling}>
              {canceling ? <Loader2 className="animate-spin" /> : <Ban />}
              Cancel
            </Button>
          )}
          <Badge variant={BUCKET_BADGE[bucket]}>{isReply ? "message" : stateLabel(task.state)}</Badge>
        </div>
      </header>

      {isReply && (
        <p className="text-muted-foreground text-xs">
          The agent answered with a plain Message — no Task was created, so there is no lifecycle or artifacts to track.
          Your next message continues this conversation.
        </p>
      )}

      {needsInput && (
        <div className="border-warning/40 bg-warning/10 flex items-start gap-3 rounded-xl border px-4 py-3">
          {bucket === "needs-input" && task.state.includes("AUTH") ? (
            <KeyRound className="text-warning mt-0.5 size-4 shrink-0" />
          ) : (
            <UserRound className="text-warning mt-0.5 size-4 shrink-0" />
          )}
          <div className="min-w-0 text-sm">
            <p className="font-semibold">
              {task.state.includes("AUTH") ? "The agent needs you to authenticate" : "The agent is waiting for your input"}
            </p>
            {prompt?.parts.map((part, index) => (
              <div key={index} className="mt-2">
                <PartRenderer part={part} />
              </div>
            ))}
            <p className="text-muted-foreground mt-2 text-xs">Reply below — it continues this same task.</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-5 py-2">
            {task.messages.map((message) => (
              <div key={message.id} className={cn("flex items-start gap-3", message.role === "user" && "flex-row-reverse")}>
                <Avatar className="mt-0.5 size-7 shrink-0">
                  <AvatarFallback className={message.role === "user" ? "bg-primary text-primary-foreground" : undefined}>
                    {message.role === "user" ? "You" : "AI"}
                  </AvatarFallback>
                </Avatar>
                <div className={cn("flex min-w-0 max-w-[85%] flex-col gap-2", message.role === "user" && "items-end")}>
                  {message.fromStatus && (
                    <span className="text-warning text-[11px] font-medium">Status message · {stateLabel(task.state)}</span>
                  )}
                  {message.parts.map((part, index) => (
                    <PartRenderer key={`${message.id}-${index}`} part={part} />
                  ))}
                  {!!message.referenceTaskIds?.length && (
                    <span className="text-muted-foreground text-[11px]">
                      references {message.referenceTaskIds.map((id) => id.slice(0, 8)).join(", ")}
                    </span>
                  )}
                </div>
              </div>
            ))}
            <ArtifactGallery artifacts={task.artifacts} />
          </div>

          <Card>
            <CardContent className="flex flex-col gap-3">
              {isTerminal && (
                <p className="text-muted-foreground text-xs">
                  This task has reached a terminal state and can&apos;t take new messages. Sending here starts a new
                  task in the same conversation.
                </p>
              )}
              <MessageComposer
                placeholder={
                  isTerminal
                    ? "Ask for a refinement or a new follow-up…"
                    : needsInput
                      ? "Answer the agent to resume the task…"
                      : "Send a follow-up message…"
                }
                submitLabel={isTerminal ? "Start follow-up task" : needsInput ? "Reply" : "Send"}
                submitIcon={isTerminal ? <Plus /> : <Send />}
                sending={sending}
                sendingLabel={isTerminal ? "Starting…" : "Sending…"}
                referenceableTasks={referenceableTasks}
                minRows="sm"
                onSubmit={submit}
              />
            </CardContent>
          </Card>
          {error && (
            <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-4 py-3 text-sm">
              {error}
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          {!isReply && (
            <Card>
              <CardHeader className="pb-0">
                <h2 className="text-sm font-semibold">Lifecycle</h2>
              </CardHeader>
              <CardContent>
                <TaskLifecycle state={task.state} transitions={task.transitions} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader className="pb-0">
              <h2 className="text-sm font-semibold">Identifiers</h2>
            </CardHeader>
            <CardContent>
              <IdentifiersPanel task={task} />
            </CardContent>
          </Card>
          {contextSiblings.length > 0 && (
            <Card>
              <CardHeader className="pb-0">
                <h2 className="text-sm font-semibold">Same conversation</h2>
                <p className="text-muted-foreground text-xs">One context can hold many tasks.</p>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5">
                {contextSiblings.map((related) => (
                  <Link
                    key={related.taskId}
                    href={`/tasks/${related.taskId}`}
                    className="border-border hover:border-primary/50 hover:bg-accent/40 flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors"
                  >
                    <span className="text-muted-foreground truncate font-mono">
                      {related.kind === "message" ? "reply" : related.taskId.slice(0, 8)}
                    </span>
                    <Badge variant={BUCKET_BADGE[taskBucket(related.state)]} className="shrink-0">
                      {related.kind === "message" ? "message" : stateLabel(related.state)}
                    </Badge>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </section>
  );
}
