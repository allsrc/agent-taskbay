"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { StateChip } from "@/components/a2a/primitives";
import { ListPane, ListRow, ListStatus, MasterDetail } from "@/components/console/master-detail";
import { FilterChips } from "@/components/patterns/filter-chips";
import { Button } from "@/components/ui/button";
import { isActiveState, needsYou, relativeTime, taskTitle } from "@/lib/task-view";
import { dueLabel, isOverdue } from "@/lib/workflow";
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
} as const;
const API_FILTER = { All: "all", Active: "active", "Needs you": "needs-input", Done: "done", Mine: "mine", Overdue: "overdue", Unassigned: "unassigned" } as const;

const FILTER_NAMES = Object.keys(FILTERS) as Array<keyof typeof FILTERS>;

export default function TasksLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const activeId = pathname.split("/")[2];
  const [filter, setFilter] = useState<keyof typeof FILTERS>("All");
  const [offset, setOffset] = useState(0);
  const apiFilter = API_FILTER[filter];
  const resource = useServerResource<{ tasks: DurableTaskView[] }>(`/api/tasks?filter=${apiFilter}&limit=50&offset=${offset}`);
  const rows = resource.data?.tasks ?? [];

  return (
    <MasterDetail
      showDetail={Boolean(activeId)}
      list={
        <ListPane
          title="Tasks"
          controls={
            <FilterChips
              className="md:flex-wrap md:overflow-x-visible"
              label="Filter tasks"
              options={FILTER_NAMES.map((name) => ({ value: name, label: name }))}
              value={[filter]}
              onValueChange={(next) => { setFilter((next[0] as keyof typeof FILTERS | undefined) ?? "All"); setOffset(0); }}
            />
          }
          footer={
            <>
              <Button variant="outline" size="sm" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button>
              <Button variant="ghost" size="sm" onClick={resource.refresh}>Refresh</Button>
              <Button variant="outline" size="sm" disabled={rows.length < 50} onClick={() => setOffset(offset + 50)}>Next</Button>
            </>
          }
        >
          <ListStatus
            loading={resource.loading}
            loadingLabel="Loading tasks"
            error={resource.error}
            onRetry={resource.refresh}
            empty={rows.length === 0}
            emptyText="No tasks here yet. Start a chat and ask an agent to do work."
          />
          {rows.map((task) => (
            <ListRow key={task.localId} href={`/tasks/${task.localId}`} active={activeId === task.localId}>
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{taskTitle(task)}</span>
                <StateChip state={task.state} />
              </div>
              <div className="truncate font-mono text-[11px] text-muted-foreground">
                {task.taskId.slice(0, 8)} · {task.agentName} · {relativeTime(task.updatedAt)}
              </div>
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
