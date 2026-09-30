"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShallow } from "zustand/react/shallow";
import { SplitPane, StateChip } from "@/components/a2a/primitives";
import { isActiveState, needsYou, relativeTime, taskTitle } from "@/lib/task-view";
import { useTaskStore } from "@/store/task-store";
import { cn } from "@/lib/utils";

const FILTERS = {
  All: () => true,
  Active: (state: string) => isActiveState(state),
  "Needs you": (state: string) => needsYou(state),
  Done: (state: string) => !isActiveState(state),
} as const;

export default function TasksLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const activeId = pathname.split("/")[2];
  const tasks = useTaskStore(useShallow((state) => Object.values(state.tasks)));
  const [filter, setFilter] = useState<keyof typeof FILTERS>("All");
  const rows = useMemo(
    () =>
      tasks
        .filter((task) => task.kind !== "message" && FILTERS[filter](task.state))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [tasks, filter],
  );

  return (
    <SplitPane
      showDetail={Boolean(activeId)}
      list={
        <>
          <h1 className="px-4 pt-4 pb-2 font-mono text-lg font-bold tracking-tight">Tasks</h1>
          <div className="flex flex-wrap gap-1.5 px-4 pb-2.5" role="tablist" aria-label="Filter tasks">
            {(Object.keys(FILTERS) as Array<keyof typeof FILTERS>).map((name) => (
              <button
                key={name}
                role="tab"
                aria-selected={filter === name}
                onClick={() => setFilter(name)}
                className={cn(
                  "rounded-full border px-2.5 py-1 font-mono text-xs font-medium transition-colors",
                  filter === name ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto px-2 pb-3">
            {rows.length === 0 && <p className="text-muted-foreground px-3 py-2 text-sm">No tasks here yet. Start a chat and ask an agent to do work.</p>}
            {rows.map((task) => (
              <Link
                key={task.taskId}
                href={`/tasks/${task.taskId}`}
                className={cn("flex flex-col gap-1 rounded-[10px] px-3 py-2.5 transition-colors", activeId === task.taskId ? "bg-accent" : "hover:bg-accent/50")}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">{taskTitle(task)}</span>
                  <StateChip state={task.state} />
                </div>
                <div className="text-muted-foreground truncate font-mono text-[11px]">
                  {task.taskId.slice(0, 8)} · {task.agentName} · {relativeTime(task.updatedAt)}
                </div>
              </Link>
            ))}
          </div>
        </>
      }
    >
      {children}
    </SplitPane>
  );
}
