"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Inbox, LayoutGrid, ListChecks, MessageSquare, ScrollText, SlidersHorizontal, Workflow, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { LogoMark, Wordmark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
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
  href: string;
  label: string;
  short: string;
  icon: LucideIcon;
  /** Shown only to administrators; the server enforces access regardless. */
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { href: "/agents", label: "Agents", short: "Agents", icon: LayoutGrid },
  { href: "/chat", label: "Chat", short: "Chat", icon: MessageSquare },
  { href: "/inbox", label: "Inbox", short: "Inbox", icon: Inbox },
  { href: "/tasks", label: "Tasks", short: "Tasks", icon: ListChecks },
  { href: "/flows", label: "Orchestration", short: "Flows", icon: Workflow },
  { href: "/audit", label: "Audit", short: "Audit", icon: ScrollText, adminOnly: true },
  { href: "/notifications", label: "Notifications", short: "Alerts", icon: Bell },
  { href: "/settings", label: "Settings", short: "Setup", icon: SlidersHorizontal },
];

function useActive() {
  const pathname = usePathname() ?? "/";
  // The standalone approvals queue now lives in the inbox, so its review pages keep the Inbox item active.
  const path = pathname === "/approvals" || pathname.startsWith("/approvals/") ? pathname.replace("/approvals", "/inbox") : pathname;
  return NAV.find((item) => path === item.href || path.startsWith(`${item.href}/`));
}

export function AppShell({ children, identity }: { children: React.ReactNode;
  identity: { displayName: string; role: string; development: boolean } }) {
  const active = useActive();
  const nav = NAV.filter((item) => !item.adminOnly || identity.role === "admin");
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

  return (
    <div className="bg-background text-foreground flex h-dvh overflow-hidden">
      <DurableTaskSync />
      <aside className="bg-sidebar border-border hidden w-[212px] shrink-0 flex-col gap-1 border-r px-3 py-4 md:flex">
        <Link href="/chat" className="flex items-center gap-2.5 px-2 pb-5">
          <LogoMark size={30} />
          <Wordmark className="text-[15px]" />
        </Link>
        <nav className="flex flex-col gap-1" aria-label="Primary">
          {nav.map((item) => {
            const on = active?.href === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                  on ? "text-primary" : "hover:bg-accent/60",
                )}
              >
                {on && (
                  <motion.span
                    layoutId="nav-active"
                    className="bg-accent absolute inset-0 rounded-lg"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <item.icon className="relative size-[18px]" strokeWidth={1.8} />
                <span className="relative flex-1">{item.label}</span>
                {item.href === "/notifications" && unread > 0 && (
                  <span className="bg-brand text-brand-foreground relative rounded-full px-1.5 font-mono text-[11px] font-bold" aria-label={`${unread} unread notifications`}>{unreadLabel(unread)}</span>
                )}
                {item.href === "/inbox" && pending > 0 && (
                  <span className="bg-brand text-brand-foreground relative rounded-full px-1.5 font-mono text-[11px] font-bold" aria-label={`${pending} pending approvals`}>{pending}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="flex-1" />
        <IdentityMenu identity={identity} />
        <ThemeToggle className="mb-2" />
        <div className="border-border flex flex-col gap-0.5 rounded-xl border px-3 py-2.5">
          <span className="label-mono">Tenant</span>
          <span className="truncate font-mono text-[13px] font-medium">{tenant}</span>
          <span className="text-success font-mono text-[11px]">● A2A v1.0</span>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="border-border flex h-[52px] shrink-0 items-center gap-2.5 border-b px-4 md:hidden">
          <LogoMark size={26} />
          <span className="flex-1 font-mono text-[15px] font-bold">{active?.label ?? "A2A Ops"}</span>
          <ThemeToggle className="w-24" />
        </header>
        <div className="px-4 pt-2 md:hidden"><IdentityMenu identity={identity} /></div>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {taskError && <p role="alert" className="text-destructive border-b p-3 text-sm">{taskError} Retrying server sync…</p>}
          {children}
        </main>

        <nav className="bg-sidebar border-border flex shrink-0 border-t px-1 pt-1.5 pb-3.5 md:hidden" aria-label="Primary">
          {nav.map((item) => {
            const on = active?.href === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={cn("flex flex-1 flex-col items-center gap-0.5 py-1.5", on ? "text-primary" : "text-muted-foreground")}
              >
                <span className="relative">
                  <item.icon className="size-[22px]" strokeWidth={1.8} />
                  {((item.href === "/notifications" && unread > 0) || (item.href === "/inbox" && pending > 0)) && (
                    <span className="bg-brand absolute -top-0.5 -right-1.5 size-[9px] rounded-full" />
                  )}
                </span>
                <span className="font-mono text-[10px] font-medium">{item.short}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
