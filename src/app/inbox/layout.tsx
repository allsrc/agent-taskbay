"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { RotateCw } from "lucide-react";
import { SplitPane, StateChip } from "@/components/a2a/primitives";
import { DecisionStatusChip, RiskChip } from "@/components/approvals/badges";
import { Button } from "@/components/ui/button";
import { expiryLabel } from "@/lib/approvals";
import { inboxHref, inboxQuery, type InboxFilters } from "@/lib/inbox-view";
import { isActiveState, relativeTime } from "@/lib/task-view";
import { dueLabel, isOverdue } from "@/lib/workflow";
import { useServerResource } from "@/lib/use-server-resource";
import type { DecisionStatus } from "@/shared/decision-types";
import type { InboxKind, InboxPageView, InboxView } from "@/shared/inbox-types";
import { cn } from "@/lib/utils";

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
  const chip = (on: boolean) => cn("rounded-full border px-2.5 py-1 font-mono text-xs font-medium transition-colors", on ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground");

  return (
    <SplitPane
      showDetail={Boolean(activeId)}
      list={
        <>
          <h1 className="px-4 pt-4 pb-2 font-mono text-lg font-bold tracking-tight">Inbox</h1>
          <div className="flex flex-wrap gap-1.5 px-4 pb-2" role="tablist" aria-label="Inbox view">
            {VIEWS.map((candidate) => (
              <button key={candidate.id} role="tab" aria-selected={view === candidate.id} onClick={() => setView(candidate.id)} className={chip(view === candidate.id)}>{candidate.label}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 px-4 pb-2.5 text-xs">
            <label className="flex items-center gap-1.5"><span className="text-muted-foreground">Show</span>
              <select value={kind} onChange={(event) => setKind(event.target.value as InboxKind | "")} className="border-border bg-background rounded-md border px-1.5 py-1">
                {KINDS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select></label>
            <label className="flex items-center gap-1.5"><span className="text-muted-foreground">Risk</span>
              <select value={risk} onChange={(event) => setRisk(event.target.value as InboxFilters["risk"])} className="border-border bg-background rounded-md border px-1.5 py-1">
                <option value="">Any</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select></label>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto px-2 pb-3">
            {first.loading && <p className="px-3 py-2 text-sm" role="status">Loading inbox…</p>}
            {first.error && <div className="px-3 py-2 text-sm" role="alert">{first.error} <button onClick={first.refresh} className="text-primary underline">Retry</button></div>}
            {problem && <div className="px-3 py-2 text-sm" role="alert">{problem}</div>}
            {!first.loading && !first.error && items.length === 0 && <p className="text-muted-foreground px-3 py-2 text-sm">Nothing here. Try another view, or start a chat and ask an agent to do work.</p>}
            {items.map((item) => (
              <Link key={`${item.kind}:${item.id}`} href={inboxHref(item)}
                className={cn("flex flex-col gap-1 rounded-[10px] px-3 py-2.5 transition-colors", activeId === item.id ? "bg-accent" : "hover:bg-accent/50")}>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground font-mono text-[10px] uppercase">{item.kind === "approval" ? "Approval" : "Task"}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{item.title}</span>
                  {item.kind === "approval" ? <DecisionStatusChip status={item.status as DecisionStatus} /> : <StateChip state={item.status} />}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                  {item.risk && <RiskChip risk={item.risk} />}
                  <span className="text-muted-foreground truncate">{item.agentName} · {relativeTime(item.updatedAt)}</span>
                  {item.assigneeName && <span className="text-muted-foreground">→ {item.assigneeName}</span>}
                  {item.kind === "approval" && item.open && item.expiresAt && (
                    <span className={isOverdue(item.expiresAt) ? "text-brand" : "text-muted-foreground"}>{expiryLabel(item.expiresAt)}</span>)}
                  {item.kind === "task" && item.dueAt && isActiveState(item.status) && (
                    <span className={isOverdue(item.dueAt) ? "text-brand" : "text-muted-foreground"}>{dueLabel(item.dueAt)}</span>)}
                  {item.escalationLevel > 0 && <span className="text-auth">escalated</span>}
                </div>
              </Link>
            ))}
            {cursor && (
              <div className="p-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadMore}
                  disabled={more}
                  className="w-full text-xs"
                >
                  {more ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </div>
          <div className="border-border flex items-center justify-end border-t px-3 pt-2 pb-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={first.refresh}
              className="h-8 gap-1 px-2.5 text-xs"
            >
              <RotateCw className="size-3.5" /> Refresh
            </Button>
          </div>
        </>
      }
    >
      {children}
    </SplitPane>
  );
}
