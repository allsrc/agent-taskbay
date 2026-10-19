"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { SearchCheck } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { StateChip } from "@/components/a2a/primitives";
import { ListPane, ListRow, ListStatus, MasterDetail } from "@/components/console/master-detail";
import { FilterChips } from "@/components/patterns/filter-chips";
import { Pill } from "@/components/patterns/status";
import { ContextFilterChip } from "@/components/tasks/context-filter-chip";
import { Button, buttonVariants } from "@/components/ui/button";
import { isActiveState, needsYou, relativeTime, taskTitle } from "@/lib/task-view";
import { dueLabel, isOverdue } from "@/lib/workflow";
import { taskListQuery, TASK_PAGE_SIZE } from "@/lib/task-list-query";
import { useServerResource } from "@/lib/use-server-resource";
import type { DurableTaskView } from "@/shared/task-types";

const FILTERS = {
  All: () => true,
  Active: (state: string) => isActiveState(state),
  "Needs you": (state: string) => needsYou(state),
  Done: (state: string) => !isActiveState(state),
  Mine: () => true,
  Overdue: () => true,
  Unassigned: () => true,
  Discovered: () => true,
} as const;
const API_FILTER = { All: "all", Active: "active", "Needs you": "needs-input", Done: "done", Mine: "mine", Overdue: "overdue", Unassigned: "unassigned", Discovered: "all" } as const;

const FILTER_NAMES = Object.keys(FILTERS) as Array<keyof typeof FILTERS>;

export default function TasksLayout({ children }: { children: React.ReactNode }) {
  // The query string (for example /tasks?contextId=…&agentId=… from a task page) seeds the context filter.
  return <Suspense><TasksShell>{children}</TasksShell></Suspense>;
}

function TasksShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const params = useSearchParams();
  const activeId = pathname.split("/")[2];
  const [filter, setFilter] = useState<keyof typeof FILTERS>("All");
  // Cursors of the pages already passed; the last one is the current page, and an empty stack is the first page.
  const [cursors, setCursors] = useState<string[]>([]);
  // Kept in state so the narrowing survives opening a task (that address has no query string).
  const [context, setContext] = useState<{ contextId: string; agentId: string } | null>(null);
  const [seen, setSeen] = useState("");
  const linkedContext = params.get("contextId"), linkedAgent = params.get("agentId");
  const linked = linkedContext ? `${linkedContext}\n${linkedAgent ?? ""}` : "";
  if (linked !== seen) {
    setSeen(linked);
    if (linkedContext) { setContext({ contextId: linkedContext, agentId: linkedAgent ?? "" }); setCursors([]); }
  }
  const apiFilter = API_FILTER[filter];
  const resource = useServerResource<{ tasks: DurableTaskView[]; next: string | null }>(`/api/tasks?${taskListQuery({
    filter: apiFilter, origin: filter === "Discovered" ? "discovered" : undefined, contextId: context?.contextId, agentId: context?.agentId || undefined, after: cursors.at(-1),
  }, TASK_PAGE_SIZE)}`);
  const rows = resource.data?.tasks ?? [];
  const next = resource.data?.next ?? null;
  const clearContext = () => { setContext(null); setCursors([]); if (linkedContext) router.replace("/tasks"); };

  return (
    <MasterDetail
      showDetail={Boolean(activeId)}
      list={
        <ListPane
          title="Tasks"
          actions={<Link href={"/discover" as Route} className={buttonVariants({ variant: "outline", size: "sm" })}><SearchCheck /> Find tasks</Link>}
          controls={
            <div className="space-y-2">
            <FilterChips
              className="md:flex-wrap md:overflow-x-visible"
              label="Filter tasks"
              options={FILTER_NAMES.map((name) => ({ value: name, label: name }))}
              value={[filter]}
              onValueChange={(value) => { setFilter((value[0] as keyof typeof FILTERS | undefined) ?? "All"); setCursors([]); }}
            />
            {context && <ContextFilterChip contextId={context.contextId} onClear={clearContext} />}
            </div>
          }
          footer={
            <>
              <Button variant="outline" size="sm" disabled={!cursors.length} onClick={() => setCursors(cursors.slice(0, -1))}>Previous</Button>
              <Button variant="ghost" size="sm" onClick={resource.refresh}>Refresh</Button>
              <Button variant="outline" size="sm" disabled={!next} onClick={() => next && setCursors([...cursors, next])}>Next</Button>
            </>
          }
        >
          <ListStatus
            loading={resource.loading}
            loadingLabel="Loading tasks"
            error={resource.error}
            onRetry={resource.refresh}
            empty={rows.length === 0}
            emptyText={context ? "No tasks in this context match this filter." : "No tasks here yet. Start a chat and ask an agent to do work."}
          />
          {rows.map((task) => (
            <ListRow key={task.localId} href={`/tasks/${task.localId}`} active={activeId === task.localId}>
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{taskTitle(task)}</span>
                <StateChip state={task.state} />
              </div>
              <div className="truncate font-mono text-[11px] text-muted-foreground">
                Task {task.taskId.slice(0, 8)} · {task.agentName} · {relativeTime(task.updatedAt)}
              </div>
              {task.origin === "discovered" && <Pill tone="neutral">Discovered</Pill>}
              {task.workflow && (task.workflow.assigneeName || task.workflow.dueAt) && (
                <div className="flex flex-wrap items-center gap-x-2 font-mono text-[11px]">
                  {task.workflow.assigneeName && <span className="text-muted-foreground">→ {task.workflow.assigneeName}</span>}
                  {task.workflow.dueAt && isActiveState(task.state) && (
                    <span className={isOverdue(task.workflow.dueAt) ? "text-danger" : "text-muted-foreground"}>{dueLabel(task.workflow.dueAt)}</span>)}
                  {task.workflow.escalationLevel > 0 && <span className="text-info">escalated</span>}
                </div>
              )}
            </ListRow>
          ))}
        </ListPane>
      }
    >
      {children}
    </MasterDetail>
  );
}
