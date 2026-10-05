"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/a2a/primitives";
import { Button } from "@/components/ui/button";
import { KIND_LABEL, NOTIFICATIONS_CHANGED, needsAction, safeLink, unreadLabel } from "@/lib/notification-view";
import { relativeTime } from "@/lib/task-view";
import { useServerResource } from "@/lib/use-server-resource";
import type { InboxPage, NotificationView } from "@/shared/notification-types";
import { cn } from "@/lib/utils";

const PAGE = 30;

export default function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  return <Inbox key={String(unreadOnly)} unreadOnly={unreadOnly} onFilter={setUnreadOnly} />;
}

/** The signed-in member's own notifications, kept on the server; read marks follow the person, not the browser. */
function Inbox({ unreadOnly, onFilter }: { unreadOnly: boolean; onFilter: (unreadOnly: boolean) => void }) {
  const router = useRouter();
  const first = useServerResource<InboxPage>(`/api/notifications?limit=${PAGE}${unreadOnly ? "&unread=true" : ""}`);
  const [older, setOlder] = useState<InboxPage[]>([]);
  const [more, setMore] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pages = first.data ? [first.data, ...older] : [];
  const seen = new Set<string>();
  const items = pages.flatMap((page) => page.items).filter((item) => !seen.has(item.id) && seen.add(item.id));
  const unread = first.data?.unread ?? 0;

  async function mark(body: { ids: string[] } | { all: true }) {
    try {
      const response = await fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error((await response.json())?.error?.message ?? "Could not save the read mark.");
      setProblem(null);
    } catch (cause) { setProblem(cause instanceof Error ? cause.message : "Could not save the read mark."); }
    finally { first.refresh(); window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED)); }
  }
  async function open(item: NotificationView) {
    if (!item.readAt) await mark({ ids: [item.id] });
    router.push(safeLink(item.link));
  }
  async function loadMore() {
    const cursor = pages.at(-1)?.next; if (!cursor) return;
    setMore(true);
    try {
      const response = await fetch(`/api/notifications?limit=${PAGE}&cursor=${encodeURIComponent(cursor)}${unreadOnly ? "&unread=true" : ""}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not load older notifications.");
      setOlder((previous) => [...previous, body as InboxPage]);
    } catch (cause) { setProblem(cause instanceof Error ? cause.message : "Could not load older notifications."); }
    finally { setMore(false); }
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="min-w-32 flex-1 font-mono text-lg font-bold tracking-tight">Notifications</h1>
        <div className="flex gap-1.5" role="tablist" aria-label="Filter notifications">
          {[{ label: "All", value: false }, { label: "Unread", value: true }].map((tab) => (
            <button key={tab.label} role="tab" aria-selected={unreadOnly === tab.value} onClick={() => onFilter(tab.value)}
              className={cn("rounded-full border px-2.5 py-1 font-mono text-xs font-medium transition-colors", unreadOnly === tab.value ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
              {tab.label}{tab.value && unread > 0 ? ` (${unreadLabel(unread)})` : ""}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" disabled={unread === 0} onClick={() => mark({ all: true })}>Mark all read</Button>
      </div>
      <p className="text-muted-foreground mt-2 mb-3 max-w-2xl text-[13px]">
        Your own notifications about approvals and tasks you are responsible for. They are kept for you on the server, so read marks follow you across browsers.
      </p>
      {(problem || first.error) && <p role="alert" className="text-brand mb-3 text-sm">{problem ?? first.error} <button className="text-primary underline" onClick={first.refresh}>Retry</button></p>}
      {first.loading ? <p role="status" className="text-muted-foreground">Loading notifications…</p> : items.length === 0 ? (
        <EmptyState icon={<Bell className="size-7" />} title={unreadOnly ? "Nothing unread" : "All quiet"}>
          Approvals that need you, tasks assigned or escalated to you, and tasks that need input will appear here.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="Notifications">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => open(item)} data-kind={item.kind} data-unread={item.readAt ? "false" : "true"}
                className={cn("border-border flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors", item.readAt ? "hover:bg-accent/30" : "bg-card hover:bg-accent/60")}>
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.readAt ? "bg-transparent" : "bg-brand")} aria-label={item.readAt ? undefined : "Unread"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="font-semibold">{item.title}</span>
                    {needsAction(item.kind) && !item.readAt && <span className="text-warning bg-warning/15 rounded-full px-1.5 font-mono text-[10px]">ACTION</span>}</div>
                  <div className="text-muted-foreground text-[13px] break-words">{item.body}</div>
                  <div className="text-muted-foreground mt-0.5 font-mono text-[11px]">{KIND_LABEL[item.kind]} · {relativeTime(item.createdAt)}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {pages.at(-1)?.next && <Button variant="outline" size="sm" className="mt-3" disabled={more} onClick={loadMore}>{more && <Loader2 className="animate-spin" />} Show older notifications</Button>}
    </div>
  );
}
