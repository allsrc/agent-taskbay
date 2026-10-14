"use client";

import { Suspense, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { StateChip } from "@/components/a2a/primitives";
import { ListPane, ListRow, ListStatus, MasterDetail } from "@/components/console/master-detail";
import { FilterChips } from "@/components/patterns/filter-chips";
import { Tag } from "@/components/patterns/status";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { DecisionStatusChip, RiskChip } from "@/components/approvals/badges";
import { expiryLabel } from "@/lib/approvals";
import { inboxHref, inboxQuery, type InboxFilters } from "@/lib/inbox-view";
import { isActiveState, relativeTime } from "@/lib/task-view";
import { dueLabel, isOverdue } from "@/lib/workflow";
import { useServerResource } from "@/lib/use-server-resource";
import type { DecisionStatus } from "@/shared/decision-types";
import type { InboxKind, InboxPageView, InboxView } from "@/shared/inbox-types";

const VIEWS: Array<{ id: InboxView; label: string }> = [
  { id: "needs-input", label: "Needs you" }, { id: "assigned", label: "Mine" }, { id: "overdue", label: "Overdue" },
  { id: "active", label: "Active" }, { id: "done", label: "Done" }, { id: "all", label: "All" },
];
const KINDS: Array<{ id: InboxKind | ""; label: string }> = [{ id: "", label: "Everything" }, { id: "task", label: "Tasks" }, { id: "approval", label: "Approvals" }];
const PAGE = 30;

export default function InboxLayout({ children }: { children: React.ReactNode }) {
  // The query string seeds the first filters (for example /inbox?kind=approval from the old Approvals link).
  return <Suspense><InboxShell>{children}</InboxShell></Suspense>;
}

function InboxShell({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const segments = (usePathname() ?? "").split("/");
  const activeId = segments[3];
  const [view, setView] = useState<InboxView>((VIEWS.find((candidate) => candidate.id === params.get("view"))?.id) ?? "needs-input");
  const [kind, setKind] = useState<InboxKind | "">(params.get("kind") === "task" || params.get("kind") === "approval" ? (params.get("kind") as InboxKind) : "");
  const [risk, setRisk] = useState<InboxFilters["risk"]>("");
  const filters: InboxFilters = { view, kind, risk };
  const first = useServerResource<InboxPageView>(`/api/inbox?${inboxQuery(filters, PAGE)}`);
  const [older, setOlder] = useState<{ key: string; pages: InboxPageView[] }>({ key: "", pages: [] });
  const [more, setMore] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const key = JSON.stringify(filters);
  const pages = first.data ? [first.data, ...(older.key === key ? older.pages : [])] : [];
  const seen = new Set<string>();
  const items = pages.flatMap((page) => page.items).filter((item) => !seen.has(`${item.kind}:${item.id}`) && seen.add(`${item.kind}:${item.id}`));
  const cursor = pages.at(-1)?.next ?? null;

  async function loadMore() {
    if (!cursor) return;
    setMore(true);
    try {
      const response = await fetch(`/api/inbox?${inboxQuery(filters, PAGE, cursor)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not load more.");
      setOlder((previous) => ({ key, pages: [...(previous.key === key ? previous.pages : []), body as InboxPageView] }));
      setProblem(null);
    } catch (cause) { setProblem(cause instanceof Error ? cause.message : "Could not load more."); }
    finally { setMore(false); }
  }

  return (
    <MasterDetail
      showDetail={Boolean(activeId)}
      list={
        <ListPane
          title="Inbox"
          controls={
            <div className="space-y-3">
              <FilterChips
                className="md:flex-wrap md:overflow-x-visible"
                label="Inbox view"
                options={VIEWS.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
                value={[view]}
                onValueChange={(next) => setView((next[0] as InboxView | undefined) ?? "all")}
              />
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs text-muted-foreground">Show
                  <NativeSelect value={kind} onChange={(event) => setKind(event.target.value as InboxKind | "")}>
                    {KINDS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </NativeSelect>
                </label>
                <label className="space-y-1 text-xs text-muted-foreground">Risk
                  <NativeSelect value={risk} onChange={(event) => setRisk(event.target.value as InboxFilters["risk"])}>
                    <option value="">Any</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                  </NativeSelect>
                </label>
              </div>
            </div>
          }
          footer={<><span /><Button variant="ghost" size="sm" onClick={first.refresh}>Refresh</Button></>}
        >
          <ListStatus
            loading={first.loading}
            loadingLabel="Loading inbox"
            error={problem ?? first.error}
            onRetry={first.refresh}
            empty={items.length === 0}
            emptyText="Nothing here. Try another view, or start a chat and ask an agent to do work."
          />
          {items.map((item) => (
            <ListRow key={`${item.kind}:${item.id}`} href={inboxHref(item)} active={activeId === item.id}>
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
                {item.kind === "approval" ? <DecisionStatusChip status={item.status as DecisionStatus} /> : <StateChip state={item.status} />}
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted-foreground">
                <Tag>{item.kind === "approval" ? "Approval" : "Task"}</Tag>
                {item.risk && <RiskChip risk={item.risk} />}
                <span className="truncate">{item.agentName} · {relativeTime(item.updatedAt)}</span>
                {item.assigneeName && <span>→ {item.assigneeName}</span>}
                {item.kind === "approval" && item.open && item.expiresAt && (
                  <span className={isOverdue(item.expiresAt) ? "text-danger" : undefined}>{expiryLabel(item.expiresAt)}</span>)}
                {item.kind === "task" && item.dueAt && isActiveState(item.status) && (
                  <span className={isOverdue(item.dueAt) ? "text-danger" : undefined}>{dueLabel(item.dueAt)}</span>)}
                {item.escalationLevel > 0 && <span className="text-info">escalated</span>}
              </div>
            </ListRow>
          ))}
          {cursor && <div className="p-3"><Button variant="outline" size="sm" className="w-full" onClick={loadMore} disabled={more}>{more ? "Loading…" : "Load more"}</Button></div>}
        </ListPane>
      }
    >
      {children}
    </MasterDetail>
  );
}
