"use client";

import { useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Loader2, Plus, Send, Workflow } from "lucide-react";
import { toast } from "sonner";
import { sendAndStream } from "@/lib/client-stream";
import { assembleArtifacts, assembleTasks, extractMessages, normalizeParts } from "@/lib/content";
import { taskBucket, useTaskStore, type TaskBucket, type ThreadMessage } from "@/store/task-store";
import { useShallow } from "zustand/react/shallow";
import { PartRenderer } from "@/components/PartRenderer";
import { ArtifactGallery } from "@/components/ArtifactGallery";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const BUCKET_BADGE: Record<TaskBucket, "warning" | "default" | "success" | "destructive"> = {
  "needs-input": "warning",
  "in-progress": "default",
  completed: "success",
  failed: "destructive",
};

/** A task in one of these buckets is terminal (A2A spec: completed/failed/canceled/rejected can't accept new messages). */
const TERMINAL_BUCKETS: TaskBucket[] = ["completed", "failed"];

export default function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = use(params);
  const router = useRouter();
  const task = useTaskStore((state) => state.tasks[taskId]);
  const patchTask = useTaskStore((state) => state.patchTask);
  const upsertTask = useTaskStore((state) => state.upsertTask);
  const allTasks = useTaskStore(useShallow((state) => Object.values(state.tasks)));
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventsRef = useRef<unknown[]>([]);
  const resubscribedRef = useRef<string | null>(null);

  const bucket = task ? taskBucket(task.state) : "in-progress";
  const isTerminal = TERMINAL_BUCKETS.includes(bucket);
  const needsInput = bucket === "needs-input";
  const cancelable = !isTerminal;

  // Reconnect to a still-running task's live stream on open (A2A spec §3.1.6,
  // "tasks/resubscribe") so a reopened tab reflects what the agent did while
  // it was closed, instead of a stale local snapshot. Best-effort: not every
  // agent/transport supports it, so failures here are silent.
  useEffect(() => {
    if (!task || isTerminal || resubscribedRef.current === task.taskId) return;
    resubscribedRef.current = task.taskId;
    const events: unknown[] = [];
    sendAndStream(task.agentId, { taskId: task.taskId, contextId: task.contextId, resubscribe: true }, {
      onEvent: (event) => {
        events.push(event);
        const [updated] = assembleTasks(events);
        if (!updated) return;
        patchTask(task.taskId, {
          state: (updated.status as { state?: string } | undefined)?.state ?? task.state,
          updatedAt: new Date().toISOString(),
          artifacts: assembleArtifacts(events),
        });
      },
    }).catch((resubscribeError) => {
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

  const relatedTasks = allTasks
    .filter((candidate) => candidate.taskId !== task.taskId && candidate.contextId && candidate.contextId === task.contextId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  async function cancelTask() {
    if (canceling || !window.confirm("Cancel this task?")) return;
    setCanceling(true);
    try {
      const response = await fetch(`/api/agents/${task.agentId}/tasks/${task.taskId}/cancel`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Failed to cancel the task.");
      const state = (body?.result as { status?: { state?: string } } | undefined)?.status?.state ?? "TASK_STATE_CANCELED";
      patchTask(task.taskId, { state, updatedAt: new Date().toISOString() });
      toast.success("Task canceled");
    } catch (cancelError) {
      toast.error(cancelError instanceof Error ? cancelError.message : "Failed to cancel the task.");
    } finally {
      setCanceling(false);
    }
  }

  /** Continues the same task (still open) — history/state stay on this taskId. */
  async function resume() {
    if (!draft.trim() || sending) return;
    setSending(true);
    setError(null);
    eventsRef.current = [];
    const userMessage: ThreadMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: normalizeParts([{ text: draft, mediaType: "text/plain" }]),
      timestamp: new Date().toISOString(),
    };
    patchTask(taskId, { messages: [...task.messages, userMessage] });
    const text = draft;
    setDraft("");
    try {
      await sendAndStream(task.agentId, { text, taskId: task.taskId, contextId: task.contextId }, {
        onEvent: (event) => {
          eventsRef.current = [...eventsRef.current, event];
          const [updated] = assembleTasks(eventsRef.current);
          if (!updated) return;
          const agentMessages: ThreadMessage[] = extractMessages(updated, { includeStatusMessages: false })
            .filter((message) => message.role !== "ROLE_USER")
            .map((message) => ({
              id: String(message.messageId ?? crypto.randomUUID()),
              role: "agent",
              parts: normalizeParts(message.parts),
              timestamp: new Date().toISOString(),
            }));
          patchTask(taskId, {
            state: (updated.status as { state?: string } | undefined)?.state ?? task.state,
            updatedAt: new Date().toISOString(),
            messages: [...task.messages, userMessage, ...agentMessages],
            artifacts: assembleArtifacts(eventsRef.current),
          });
        },
        onError: (message) => setError(message),
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to send the message.");
    } finally {
      setSending(false);
    }
  }

  /**
   * A terminal task (completed/failed/canceled/rejected) can't accept new
   * messages per the A2A spec — refinements are a *new* task in the same
   * contextId, not a continuation of this one.
   */
  async function startFollowUp() {
    if (!draft.trim() || sending) return;
    setSending(true);
    setError(null);
    eventsRef.current = [];
    const userMessage: ThreadMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: normalizeParts([{ text: draft, mediaType: "text/plain" }]),
      timestamp: new Date().toISOString(),
    };
    const text = draft;
    setDraft("");
    let newTaskId: string | undefined;
    try {
      await sendAndStream(task.agentId, { text, contextId: task.contextId }, {
        onEvent: (event) => {
          eventsRef.current = [...eventsRef.current, event];
          const [newTask] = assembleTasks(eventsRef.current);
          if (!newTask) return;
          newTaskId = String(newTask.id);
          const agentMessages: ThreadMessage[] = extractMessages(newTask, { includeStatusMessages: false })
            .filter((message) => message.role !== "ROLE_USER")
            .map((message) => ({
              id: String(message.messageId ?? crypto.randomUUID()),
              role: "agent",
              parts: normalizeParts(message.parts),
              timestamp: new Date().toISOString(),
            }));
          upsertTask({
            taskId: newTaskId,
            agentId: task.agentId,
            agentName: task.agentName,
            contextId: typeof newTask.contextId === "string" ? newTask.contextId : task.contextId,
            state: (newTask.status as { state?: string } | undefined)?.state ?? "TASK_STATE_UNSPECIFIED",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [userMessage, ...agentMessages],
            artifacts: assembleArtifacts(eventsRef.current),
          });
        },
        onError: (message) => setError(message),
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to start the follow-up task.");
    } finally {
      setSending(false);
      if (newTaskId) router.push(`/tasks/${newTaskId}`);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="border-border bg-card flex items-center justify-between gap-4 rounded-xl border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Workflow className="text-primary size-4 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{task.agentName}</p>
            <p className="text-muted-foreground truncate font-mono text-[11px]">{task.taskId}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {cancelable && (
            <Button variant="outline" size="sm" onClick={cancelTask} disabled={canceling}>
              {canceling ? <Loader2 className="animate-spin" /> : <Ban />}
              Cancel
            </Button>
          )}
          <Badge variant={BUCKET_BADGE[bucket]}>
            {task.state.replace("TASK_STATE_", "").toLowerCase().replaceAll("_", " ")}
          </Badge>
        </div>
      </header>

      <div className="flex flex-col gap-5 py-2">
        {task.messages.map((message) => (
          <div
            key={message.id}
            className={cn("flex items-start gap-3", message.role === "user" && "flex-row-reverse")}
          >
            <Avatar className="mt-0.5 size-7 shrink-0">
              <AvatarFallback
                className={message.role === "user" ? "bg-primary text-primary-foreground" : undefined}
              >
                {message.role === "user" ? "You" : "AI"}
              </AvatarFallback>
            </Avatar>
            <div className={cn("flex min-w-0 max-w-[85%] flex-col gap-2", message.role === "user" && "items-end")}>
              {message.parts.map((part, index) => (
                <PartRenderer key={`${message.id}-${index}`} part={part} />
              ))}
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
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={
              isTerminal
                ? "Ask for a refinement or a new follow-up…"
                : needsInput
                  ? "The agent is waiting on your input…"
                  : "Send a follow-up message…"
            }
            disabled={sending}
            className="min-h-20"
          />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
              {sending && (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> {isTerminal ? "Starting…" : "Sending…"}
                </>
              )}
            </span>
            <Button onClick={isTerminal ? startFollowUp : resume} disabled={sending || !draft.trim()}>
              {isTerminal ? <Plus /> : <Send />}
              {isTerminal ? "Start follow-up task" : "Send"}
            </Button>
          </div>
        </CardContent>
      </Card>
      {error && (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {relatedTasks.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Other tasks in this conversation
          </h2>
          <div className="flex flex-col gap-1.5">
            {relatedTasks.map((related) => (
              <Link
                key={related.taskId}
                href={`/tasks/${related.taskId}`}
                className="border-border bg-card hover:border-primary/50 hover:bg-accent/40 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm transition-colors"
              >
                <span className="text-muted-foreground truncate font-mono text-xs">{related.taskId}</span>
                <Badge variant={BUCKET_BADGE[taskBucket(related.state)]} className="shrink-0">
                  {related.state.replace("TASK_STATE_", "").toLowerCase().replaceAll("_", " ")}
                </Badge>
              </Link>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
