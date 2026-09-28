"use client";

import Link from "next/link";
import { CheckCircle2, CircleAlert, Inbox as InboxIcon, LoaderCircle, UserRound } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { taskBucket, useTaskStore, type TaskBucket } from "@/store/task-store";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const SECTIONS: Array<{
  bucket: TaskBucket;
  label: string;
  icon: typeof InboxIcon;
  badgeVariant: "warning" | "default" | "success" | "destructive";
}> = [
  { bucket: "needs-input", label: "Needs my input", icon: UserRound, badgeVariant: "warning" },
  { bucket: "in-progress", label: "In progress", icon: LoaderCircle, badgeVariant: "default" },
  { bucket: "completed", label: "Completed", icon: CheckCircle2, badgeVariant: "success" },
  { bucket: "failed", label: "Failed / canceled", icon: CircleAlert, badgeVariant: "destructive" },
];

export default function InboxPage() {
  const tasks = useTaskStore(useShallow((state) => Object.values(state.tasks)));
  const sorted = [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Task inbox</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm">
          Tasks you started, grouped by what needs to happen next. This is browser-local state until a shared,
          durable task store is wired up (see ROADMAP.md).
        </p>
      </header>

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
                  <Link
                    key={task.taskId}
                    href={`/tasks/${task.taskId}`}
                    className="border-border bg-card hover:border-primary/50 hover:bg-accent/40 flex items-center justify-between gap-4 rounded-xl border px-4 py-3 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{task.agentName}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {task.messages.at(-1)?.parts[0]?.value
                          ? String(task.messages.at(-1)?.parts[0]?.value).slice(0, 140)
                          : "No preview available"}
                      </p>
                    </div>
                    <time className="text-muted-foreground shrink-0 text-xs">
                      {new Date(task.updatedAt).toLocaleString()}
                    </time>
                  </Link>
                ))}
              </div>
            </section>
          );
        })
      )}
    </section>
  );
}
