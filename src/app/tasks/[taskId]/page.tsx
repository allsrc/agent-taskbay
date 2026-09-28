"use client";

import { useRef, useState, use } from "react";
import { Loader2, Send, Workflow } from "lucide-react";
import { sendAndStream } from "@/lib/client-stream";
import { assembleArtifacts, assembleTasks, extractMessages, normalizeParts } from "@/lib/content";
import { taskBucket, useTaskStore, type TaskBucket, type ThreadMessage } from "@/store/task-store";
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

export default function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = use(params);
  const task = useTaskStore((state) => state.tasks[taskId]);
  const patchTask = useTaskStore((state) => state.patchTask);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventsRef = useRef<unknown[]>([]);

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

  const bucket = taskBucket(task.state);
  const needsInput = bucket === "needs-input";

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
        <Badge variant={BUCKET_BADGE[bucket]} className="shrink-0">
          {task.state.replace("TASK_STATE_", "").toLowerCase().replaceAll("_", " ")}
        </Badge>
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
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={needsInput ? "The agent is waiting on your input…" : "Send a follow-up message…"}
            disabled={sending}
            className="min-h-20"
          />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
              {sending && (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Sending…
                </>
              )}
            </span>
            <Button onClick={resume} disabled={sending || !draft.trim()}>
              <Send />
              Send
            </Button>
          </div>
        </CardContent>
      </Card>
      {error && (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-4 py-3 text-sm">
          {error}
        </div>
      )}
    </section>
  );
}
