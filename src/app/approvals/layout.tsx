"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { ListPane, ListRow, ListStatus, MasterDetail } from "@/components/console/master-detail";
import { FilterChips } from "@/components/patterns/filter-chips";
import { Button } from "@/components/ui/button";
import { DecisionStatusChip, RiskChip } from "@/components/approvals/badges";
import { expiryLabel, isOpen } from "@/lib/approvals";
import { relativeTime } from "@/lib/task-view";
import { useServerResource } from "@/lib/use-server-resource";
import type { DecisionRequestView } from "@/shared/decision-types";

const FILTERS = {
  Pending: (request: DecisionRequestView) => request.status === "pending",
  "Needs changes": (request: DecisionRequestView) => request.status === "changes_requested",
  Assigned: (request: DecisionRequestView) => request.status === "pending",
  Closed: (request: DecisionRequestView) => !isOpen(request.status),
  All: () => true,
} as const;

const FILTER_NAMES = Object.keys(FILTERS) as Array<keyof typeof FILTERS>;

export default function ApprovalsLayout({ children }: { children: React.ReactNode }) {
  const activeId = (usePathname() ?? "").split("/")[2];
  const [filter, setFilter] = useState<keyof typeof FILTERS>("Pending");
  const resource = useServerResource<{ decisions: DecisionRequestView[] }>(`/api/decisions${filter === "Assigned" ? "?assigned=me" : ""}`);
  const rows = (resource.data?.decisions ?? []).filter(FILTERS[filter]);

  return (
    <MasterDetail
      showDetail={Boolean(activeId)}
      list={
        <ListPane
          title="Approvals"
          controls={
            <FilterChips
              label="Filter approvals"
              options={FILTER_NAMES.map((name) => ({ value: name, label: name }))}
              value={[filter]}
              onValueChange={(next) => setFilter((next[0] as keyof typeof FILTERS | undefined) ?? "Pending")}
            />
          }
          footer={<><span /><Button variant="ghost" size="sm" onClick={resource.refresh}>Refresh</Button></>}
        >
          <ListStatus
            loading={resource.loading}
            loadingLabel="Loading approvals"
            error={resource.error}
            onRetry={resource.refresh}
            empty={rows.length === 0}
            emptyText={`${filter === "Pending" ? "Nothing is waiting for approval." : "No approvals here."} Open a task and choose “Request approval” to record an action that needs sign-off.`}
          />
          {rows.map((request) => (
            <ListRow key={request.id} href={`/approvals/${request.id}`} active={activeId === request.id}>
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{request.title}</span>
                <DecisionStatusChip status={request.status} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <RiskChip risk={request.risk} />
                <span className="truncate font-mono text-[11px] text-muted-foreground">{request.agentName ?? "Agent"} · {isOpen(request.status) ? expiryLabel(request.expiresAt) : relativeTime(request.updatedAt)}</span>
              </div>
            </ListRow>
          ))}
        </ListPane>
      }
    >
      {children}
    </MasterDetail>
  );
}
