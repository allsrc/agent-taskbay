"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SplitPane, StateChip } from "@/components/a2a/primitives";
import { isActiveState, needsYou, relativeTime, taskTitle } from "@/lib/task-view";
import { useServerResource } from "@/lib/use-server-resource";
import type { DurableTaskView } from "@/shared/task-types";
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
  const [filter, setFilter] = useState<keyof typeof FILTERS>("All");
  const [offset, setOffset] = useState(0);
  const apiFilter = { All: "all", Active: "active", "Needs you": "needs-input", Done: "done" }[filter];
  const resource = useServerResource<{ tasks: DurableTaskView[] }>(`/api/tasks?filter=${apiFilter}&limit=50&offset=${offset}`);
  const rows = resource.data?.tasks ?? [];

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
                onClick={() => { setFilter(name); setOffset(0); }}
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
            {resource.loading && <p className="px-3 py-2 text-sm" role="status">Loading tasks…</p>}
            {resource.error && <div className="px-3 py-2 text-sm" role="alert">{resource.error} <button onClick={resource.refresh} className="text-primary underline">Retry</button></div>}
            {!resource.loading && !resource.error && rows.length === 0 && <p className="text-muted-foreground px-3 py-2 text-sm">No tasks here yet. Start a chat and ask an agent to do work.</p>}
            {rows.map((task) => (
              <Link
                key={task.localId}
                href={`/tasks/${task.localId}`}
                className={cn("flex flex-col gap-1 rounded-[10px] px-3 py-2.5 transition-colors", activeId === task.localId ? "bg-accent" : "hover:bg-accent/50")}
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
          <div className="flex items-center justify-between px-4 pb-3 text-sm">
            <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))} className="disabled:opacity-40">Previous</button>
            <button onClick={resource.refresh} className="text-primary">Refresh</button>
            <button disabled={rows.length < 50} onClick={() => setOffset(offset + 50)} className="disabled:opacity-40">Next</button>
          </div>
        </>
      }
    >
      {children}
    </SplitPane>
  );
}
