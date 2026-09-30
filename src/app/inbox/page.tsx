"use client";

import Link from "next/link";
import { CheckCircle2, CircleAlert, Inbox as InboxIcon, LoaderCircle, MessageSquare, UserRound } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { stateLabel } from "@/components/TaskLifecycle";
import { BUCKET_BADGE, taskBucket, useTaskStore, type TaskBucket, type TrackedTask } from "@/store/task-store";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const SECTIONS: Array<{
  bucket: TaskBucket;
  label: string;
  icon: typeof InboxIcon;
  badgeVariant: "warning" | "default" | "success" | "destructive" | "muted";
}> = [
  { bucket: "needs-input", label: "Needs my input", icon: UserRound, badgeVariant: "warning" },
  { bucket: "in-progress", label: "In progress", icon: LoaderCircle, badgeVariant: "default" },
  { bucket: "completed", label: "Completed", icon: CheckCircle2, badgeVariant: "success" },
  { bucket: "failed", label: "Failed / canceled", icon: CircleAlert, badgeVariant: "destructive" },
  { bucket: "replies", label: "Direct replies (no task)", icon: MessageSquare, badgeVariant: "muted" },
];

function preview(task: TrackedTask) {
  const last = [...task.messages].reverse().find((message) => message.role === "agent") ?? task.messages.at(-1);
  const part = last?.parts.find((candidate) => candidate.kind === "text");
  return part ? String(part.value).slice(0, 140) : "No preview available";
}

function TaskRow({ task }: { task: TrackedTask }) {
  return (
    <Link
      href={`/tasks/${task.taskId}`}
      className="border-border bg-card hover:border-primary/50 hover:bg-accent/40 flex items-center justify-between gap-4 rounded-xl border px-4 py-3 transition-colors"
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 truncate text-sm font-semibold">
          {task.agentName}
          <Badge variant={BUCKET_BADGE[taskBucket(task.state)]}>{task.kind === "message" ? "message" : stateLabel(task.state)}</Badge>
        </p>
        <p className="text-muted-foreground truncate text-xs">{preview(task)}</p>
      </div>
      <time className="text-muted-foreground shrink-0 text-xs">{new Date(task.updatedAt).toLocaleString()}</time>
    </Link>
  );
}

export default function InboxPage() {
  const tasks = useTaskStore(useShallow((state) => Object.values(state.tasks)));
  const sorted = [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const [view, setView] = useState<"status" | "conversation">("status");

  const conversations = new Map<string, TrackedTask[]>();
  for (const task of sorted) {
    const key = task.contextId || task.taskId;
    conversations.set(key, [...(conversations.get(key) ?? []), task]);
  }

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Task inbox</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm">
          Tasks you started, grouped by what needs to happen next. This is browser-local state until a shared,
          durable task store is wired up (see ROADMAP.md).
        </p>
      </header>

      {sorted.length > 0 && (
        <div className="flex items-center gap-1" role="tablist" aria-label="Group by">
          {(["status", "conversation"] as const).map((option) => (
            <button
              key={option}
              role="tab"
              aria-selected={view === option}
              onClick={() => setView(option)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${view === option ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {option === "status" ? "By status" : "By conversation"}
            </button>
          ))}
        </div>
      )}

      {!sorted.length ? (
        <Card className="items-center border-dashed py-14 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <InboxIcon className="text-primary size-7" />
            <p className="font-medium">No tasks yet</p>
            <p className="text-muted-foreground text-sm">
              Open the{" "}
              <Link href="/catalog" className="text-primary hover:underline">
                catalog
              </Link>{" "}
              and start a task with a registered agent.
            </p>
          </CardContent>
        </Card>
      ) : view === "conversation" ? (
        [...conversations.entries()].map(([contextId, items]) => (
          <section key={contextId} className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <span className="text-muted-foreground font-mono text-xs">context {contextId.slice(0, 8)}</span>
              <Badge variant="secondary">
                {items.length} {items.length === 1 ? "item" : "items"}
              </Badge>
            </h2>
            <div className="flex flex-col gap-2">
              {items.map((task) => (
                <TaskRow key={task.taskId} task={task} />
              ))}
            </div>
          </section>
        ))
      ) : (
        SECTIONS.map(({ bucket, label, icon: Icon, badgeVariant }) => {
          const items = sorted.filter((task) => taskBucket(task.state) === bucket);
          if (!items.length) return null;
          return (
            <section key={bucket} className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Icon className="size-4" />
                {label}
                <Badge variant={badgeVariant}>{items.length}</Badge>
              </h2>
              <div className="flex flex-col gap-2">
                {items.map((task) => (
                  <TaskRow key={task.taskId} task={task} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </section>
  );
}
