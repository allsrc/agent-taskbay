"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SplitPane } from "@/components/a2a/primitives";
import { DecisionStatusChip, RiskChip } from "@/components/approvals/badges";
import { expiryLabel, isOpen } from "@/lib/approvals";
import { relativeTime } from "@/lib/task-view";
import { useServerResource } from "@/lib/use-server-resource";
import type { DecisionRequestView } from "@/shared/decision-types";
import { cn } from "@/lib/utils";

const FILTERS = {
  Pending: (request: DecisionRequestView) => request.status === "pending",
  "Needs changes": (request: DecisionRequestView) => request.status === "changes_requested",
  Assigned: (request: DecisionRequestView) => request.status === "pending",
  Closed: (request: DecisionRequestView) => !isOpen(request.status),
  All: () => true,
} as const;

export default function ApprovalsLayout({ children }: { children: React.ReactNode }) {
  const activeId = (usePathname() ?? "").split("/")[2];
  const [filter, setFilter] = useState<keyof typeof FILTERS>("Pending");
  const resource = useServerResource<{ decisions: DecisionRequestView[] }>(`/api/decisions${filter === "Assigned" ? "?assigned=me" : ""}`);
  const rows = (resource.data?.decisions ?? []).filter(FILTERS[filter]);

  return (
    <SplitPane
      showDetail={Boolean(activeId)}
      list={
        <>
          <h1 className="px-4 pt-4 pb-2 font-mono text-lg font-bold tracking-tight">Approvals</h1>
          <div className="flex flex-wrap gap-1.5 px-4 pb-2.5" role="tablist" aria-label="Filter approvals">
            {(Object.keys(FILTERS) as Array<keyof typeof FILTERS>).map((name) => (
              <button key={name} role="tab" aria-selected={filter === name} onClick={() => setFilter(name)}
                className={cn("rounded-full border px-2.5 py-1 font-mono text-xs font-medium transition-colors",
                  filter === name ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                {name}
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto px-2 pb-3">
            {resource.loading && <p className="px-3 py-2 text-sm" role="status">Loading approvals…</p>}
            {resource.error && <div className="px-3 py-2 text-sm" role="alert">{resource.error} <button onClick={resource.refresh} className="text-primary underline">Retry</button></div>}
            {!resource.loading && !resource.error && rows.length === 0 && (
              <p className="text-muted-foreground px-3 py-2 text-sm">
                {filter === "Pending" ? "Nothing is waiting for approval." : "No approvals here."} Open a task and choose “Request approval” to record an action that needs sign-off.
              </p>
            )}
            {rows.map((request) => (
              <Link key={request.id} href={`/approvals/${request.id}`}
                className={cn("flex flex-col gap-1 rounded-[10px] px-3 py-2.5 transition-colors", activeId === request.id ? "bg-accent" : "hover:bg-accent/50")}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">{request.title}</span>
                  <DecisionStatusChip status={request.status} />
                </div>
                <div className="flex items-center gap-2">
                  <RiskChip risk={request.risk} />
                  <span className="text-muted-foreground truncate font-mono text-[11px]">{request.agentName ?? "Agent"} · {isOpen(request.status) ? expiryLabel(request.expiresAt) : relativeTime(request.updatedAt)}</span>
                </div>
              </Link>
            ))}
          </div>
          <div className="flex items-center justify-end px-4 pb-3 text-sm"><button onClick={resource.refresh} className="text-primary">Refresh</button></div>
        </>
      }
    >
      {children}
    </SplitPane>
  );
}
