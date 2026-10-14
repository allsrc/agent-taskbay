"use client";

import { useEffect, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Inbox, LayoutGrid, ListChecks, MessageSquare, MoreHorizontal, ScrollText, SlidersHorizontal, Workflow, type LucideIcon } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { MobileTopBar } from "@/components/navigation/mobile-top-bar";
import { TabBar, type TabBarItem } from "@/components/navigation/tab-bar";
import { ResponsiveDialog } from "@/components/patterns/responsive-dialog";
import { ListGroup, ListItem } from "@/components/patterns/collections";
import { StatusDot } from "@/components/patterns/status";
import { ThemeMenu, ThemeSegmented } from "@/components/theme/theme-toggle";
import { DurableTaskSync } from "@/components/chat/durable-task-sync";
import { useTaskStore } from "@/store/task-store";
import { NOTIFICATIONS_CHANGED, unreadLabel } from "@/lib/notification-view";
import type { InboxPage } from "@/shared/notification-types";
import { useAgentStore } from "@/store/agent-store";
import { useServerResource } from "@/lib/use-server-resource";
import type { DecisionRequestView } from "@/shared/decision-types";
import { cn } from "@/lib/utils";
import { IdentityMenu } from "./identity-menu";

interface NavItem {
  href: Route;
  label: string;
  short: string;
  icon: LucideIcon;
  /** Shown only to administrators; the server enforces access regardless. */
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { href: "/agents" as Route, label: "Agents", short: "Agents", icon: LayoutGrid },
  { href: "/chat" as Route, label: "Chat", short: "Chat", icon: MessageSquare },
  { href: "/inbox" as Route, label: "Inbox", short: "Inbox", icon: Inbox },
  { href: "/tasks" as Route, label: "Tasks", short: "Tasks", icon: ListChecks },
  { href: "/flows" as Route, label: "Orchestration", short: "Flows", icon: Workflow },
  { href: "/audit" as Route, label: "Audit", short: "Audit", icon: ScrollText, adminOnly: true },
  { href: "/notifications" as Route, label: "Notifications", short: "Alerts", icon: Bell },
  { href: "/settings" as Route, label: "Settings", short: "Setup", icon: SlidersHorizontal },
];

/** The list a detail screen belongs to, so the phone top bar can show a back button. */
function parentOf(pathname: string): Route | null {
  const [, section, a, b] = pathname.split("/");
  if (section === "inbox" && a && b) return "/inbox" as Route;
  if (["tasks", "agents", "chat", "approvals"].includes(section) && a) return `/${section}` as Route;
  return null;
}

/** Tabs pinned to the phone tab bar; everything else lives under "More". */
const PRIMARY_TABS = new Set<string>(["/chat", "/inbox", "/tasks", "/agents"]);

function useActive(nav: NavItem[]) {
  const pathname = usePathname() ?? "/";
  // The standalone approvals queue now lives in the inbox, so its review pages keep the Inbox item active.
  const path = pathname === "/approvals" || pathname.startsWith("/approvals/") ? pathname.replace("/approvals", "/inbox") : pathname;
  return nav.find((item) => path === item.href || path.startsWith(`${item.href}/`));
}

function CountBadge({ count, label, children }: { count: number; label: string; children: React.ReactNode }) {
  return (
    <span
      className="bg-brand text-brand-foreground ml-auto rounded-full px-1.5 font-mono text-[11px] leading-[18px] font-semibold tabular-nums"
      aria-label={`${count} ${label}`}
    >
      {children}
    </span>
  );
}

export function AppShell({ children, identity }: { children: React.ReactNode;
  identity: { displayName: string; role: string; development: boolean } }) {
  const nav = NAV.filter((item) => !item.adminOnly || identity.role === "admin");
  const active = useActive(nav);
  const [moreOpen, setMoreOpen] = useState(false);
  const unreadResource = useServerResource<InboxPage>("/api/notifications?limit=1&unread=true");
  const unread = unreadResource.data?.unread ?? 0;
  const refreshUnread = unreadResource.refresh;
  // The inbox announces its own read marks so the badge updates at once instead of at the next poll.
  useEffect(() => {
    window.addEventListener(NOTIFICATIONS_CHANGED, refreshUnread);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, refreshUnread);
  }, [refreshUnread]);
  const pending = (useServerResource<{ decisions: DecisionRequestView[] }>("/api/decisions?status=pending").data?.decisions.length) ?? 0;
  const taskError = useTaskStore((state) => state.error);
  const agents = useAgentStore((state) => state.agents);
  const refreshAgents = useAgentStore((state) => state.refresh);
  useEffect(() => {
    void refreshAgents();
  }, [refreshAgents]);
  const tenant = agents.find((agent) => agent.view?.tenant)?.view?.tenant ?? "default";

  const badgeFor = (href: string) => (href === "/notifications" ? unread : href === "/inbox" ? pending : 0);
  const tabs: TabBarItem[] = [
    ...nav.filter((item) => PRIMARY_TABS.has(item.href)).map((item) => ({ title: item.short, href: item.href, icon: item.icon })),
    { title: "More", icon: MoreHorizontal, onSelect: () => setMoreOpen(true) },
  ];
  const moreItems = nav.filter((item) => !PRIMARY_TABS.has(item.href));

  return (
    <div className="bg-background text-foreground flex min-h-dvh md:h-dvh md:overflow-hidden">
      <DurableTaskSync />
      <aside className="bg-sidebar border-sidebar-border hidden w-16 shrink-0 flex-col border-r md:flex lg:w-60" data-chrome style={{ viewTransitionName: "side-bar" }}>
        <Link href={"/chat" as Route} className="flex h-14 items-center justify-center lg:justify-start lg:px-5" aria-label="Agent Taskbay home">
          <Logo className="[&>span:last-child]:hidden lg:[&>span:last-child]:inline" />
        </Link>
        <nav className="flex flex-col gap-0.5 px-2 py-2 lg:px-3" aria-label="Primary">
          {nav.map((item) => {
            const on = active?.href === item.href;
            const count = badgeFor(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? "page" : undefined}
                title={item.label}
                className={cn(
                  "relative flex h-9 items-center justify-center gap-2.5 rounded-lg lg:justify-start lg:px-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  on ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <item.icon className={cn("size-4", on && "text-brand-text")} strokeWidth={on ? 2.25 : 2} />
                <span className="hidden flex-1 truncate lg:block">{item.label}</span>
                {count > 0 && (
                  <>
                    <span className="bg-brand absolute top-1.5 right-2.5 size-2 rounded-full lg:hidden" aria-hidden />
                    <span className="hidden lg:contents">
                      <CountBadge count={count} label={item.href === "/inbox" ? "pending approvals" : "unread notifications"}>
                        {item.href === "/notifications" ? unreadLabel(count) : count}
                      </CountBadge>
                    </span>
                  </>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="flex-1" />
        <div className="flex flex-col items-center gap-2 border-t border-sidebar-border p-2 lg:hidden">
          <ThemeMenu />
          <IdentityMenu identity={identity} compact />
        </div>
        <div className="hidden space-y-3 border-t border-sidebar-border p-3 lg:block">
          <IdentityMenu identity={identity} />
          <ThemeSegmented className="w-full" />
          <div className="bg-sunken flex flex-col gap-0.5 rounded-lg border px-3 py-2.5">
            <span className="label-mono">Tenant</span>
            <span className="truncate font-mono text-[13px] font-medium">{tenant}</span>
            <span className="text-success mt-0.5 inline-flex items-center gap-1.5 font-mono text-[11px]">
              <StatusDot tone="success" live /> v{process.env.NEXT_PUBLIC_APP_VERSION}
            </span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:min-h-0 md:pb-0">
        <MobileTopBar
          homeHref={"/chat" as Route}
          parentOf={parentOf}
          trailing={
            (unread > 0 || pending > 0) && (
              <Link
                href={(pending > 0 ? "/inbox" : "/notifications") as Route}
                className="bg-brand-soft text-brand-text inline-flex h-7 items-center rounded-full px-2.5 font-mono text-xs font-semibold tabular-nums"
                aria-label={pending > 0 ? `${pending} pending approvals` : `${unread} unread notifications`}
              >
                {pending > 0 ? pending : unreadLabel(unread)}
              </Link>
            )
          }
        />

        <main className="flex min-w-0 flex-1 flex-col md:min-h-0">
          {taskError && (
            <p role="alert" className="border-danger/30 bg-danger/10 text-danger border-b px-4 py-2.5 text-sm">
              {taskError} Retrying server sync…
            </p>
          )}
          {children}
        </main>
      </div>

      <TabBar items={tabs} />
      <ResponsiveDialog open={moreOpen} onOpenChange={setMoreOpen} title="More" description={`Signed in as ${identity.displayName}`}>
        <div className="space-y-4">
          <ListGroup>
            {moreItems.map((item) => {
              const count = badgeFor(item.href);
              return (
                <ListItem
                  key={item.href}
                  icon={item.icon}
                  title={item.label}
                  href={item.href}
                  chevron
                  trailing={count > 0 ? <span className="text-brand-text font-mono text-xs font-semibold">{count}</span> : undefined}
                  onClick={() => setMoreOpen(false)}
                />
              );
            })}
          </ListGroup>
          <IdentityMenu identity={identity} />
          <ThemeSegmented size="md" className="w-full" />
        </div>
      </ResponsiveDialog>
    </div>
  );
}
