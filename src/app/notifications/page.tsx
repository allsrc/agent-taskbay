"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/a2a/primitives";
import { Page } from "@/components/console/page";
import { ListSkeleton } from "@/components/patterns/collections";
import { Callout } from "@/components/patterns/data-display";
import { FilterChips } from "@/components/patterns/filter-chips";
import { Pill, StatusDot } from "@/components/patterns/status";
import { Button } from "@/components/ui/button";
import { KIND_LABEL, NOTIFICATIONS_CHANGED, needsAction, safeLink } from "@/lib/notification-view";
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
    <Page
      size="narrow"
      title="Notifications"
      description="Your own notifications about approvals and tasks you are responsible for. They are kept for you on the server, so read marks follow you across browsers."
      actions={<Button variant="outline" disabled={unread === 0} onClick={() => mark({ all: true })}><CheckCheck /> Mark all read</Button>}
      headerChildren={
        <FilterChips
          label="Filter notifications"
          className="pt-1"
          options={[{ value: "all", label: "All" }, { value: "unread", label: "Unread", count: unread > 0 ? unread : undefined }]}
          value={[unreadOnly ? "unread" : "all"]}
          onValueChange={(next) => onFilter(next[0] === "unread")}
        />
      }
    >
      {(problem || first.error) && (
        <Callout tone="danger" className="mb-4" action={<Button size="sm" variant="outline" onClick={first.refresh}>Retry</Button>}>{problem ?? first.error}</Callout>
      )}
      {first.loading ? <div role="status" aria-label="Loading notifications"><ListSkeleton rows={5} /></div> : items.length === 0 ? (
        <div className="flex"><EmptyState icon={Bell} title={unreadOnly ? "Nothing unread" : "All quiet"}>
          Approvals that need you, tasks assigned or escalated to you, and tasks that need input will appear here.
        </EmptyState></div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card" aria-label="Notifications">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => open(item)} data-kind={item.kind} data-unread={item.readAt ? "false" : "true"}
                className={cn("flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted", !item.readAt && "bg-brand-soft/40")}>
                <span className="mt-1.5 flex size-2 shrink-0 justify-center">{!item.readAt && <StatusDot tone="brand" />}</span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("text-sm", item.readAt ? "font-normal" : "font-medium")}>{item.title}</span>
                    {needsAction(item.kind) && !item.readAt && <Pill tone="warning">Action</Pill>}
                  </div>
                  <div className="text-sm break-words text-muted-foreground">{item.body}</div>
                  <div className="font-mono text-[11px] text-subtle-foreground">{KIND_LABEL[item.kind]} · {relativeTime(item.createdAt)}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {pages.at(-1)?.next && <Button variant="outline" className="mt-4" disabled={more} onClick={loadMore}>{more && <Loader2 className="animate-spin" />} Show older notifications</Button>}
    </Page>
  );
}
