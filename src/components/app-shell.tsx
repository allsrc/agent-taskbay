"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, LayoutGrid, ListChecks, MessageSquare, SlidersHorizontal, Workflow, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { LogoMark, Wordmark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { useNotifications } from "@/store/notification-store";
import { useAgentStore } from "@/store/agent-store";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  short: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { href: "/agents", label: "Agents", short: "Agents", icon: LayoutGrid },
  { href: "/chat", label: "Chat", short: "Chat", icon: MessageSquare },
  { href: "/tasks", label: "Tasks", short: "Tasks", icon: ListChecks },
  { href: "/flows", label: "Orchestration", short: "Flows", icon: Workflow },
  { href: "/notifications", label: "Notifications", short: "Alerts", icon: Bell },
  { href: "/settings", label: "Settings", short: "Setup", icon: SlidersHorizontal },
];

function useActive() {
  const pathname = usePathname() ?? "/";
  return NAV.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const active = useActive();
  const { unread } = useNotifications();
  const agents = useAgentStore((state) => state.agents);
  const refreshAgents = useAgentStore((state) => state.refresh);
  useEffect(() => {
    void refreshAgents();
  }, [refreshAgents]);
  const tenant = agents.find((agent) => agent.view?.tenant)?.view?.tenant ?? "default";

  return (
    <div className="bg-background text-foreground flex h-dvh overflow-hidden">
      <aside className="bg-sidebar border-border hidden w-[212px] shrink-0 flex-col gap-1 border-r px-3 py-4 md:flex">
        <Link href="/chat" className="flex items-center gap-2.5 px-2 pb-5">
          <LogoMark size={30} />
          <Wordmark className="text-[15px]" />
        </Link>
        <nav className="flex flex-col gap-1" aria-label="Primary">
          {NAV.map((item) => {
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
                  <span className="bg-brand text-brand-foreground relative rounded-full px-1.5 font-mono text-[11px] font-bold">{unread}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="flex-1" />
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
          <span className="flex-1 font-mono text-[15px] font-bold">{active?.label ?? "a2a.client"}</span>
          <ThemeToggle className="w-24" />
        </header>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>

        <nav className="bg-sidebar border-border flex shrink-0 border-t px-1 pt-1.5 pb-3.5 md:hidden" aria-label="Primary">
          {NAV.map((item) => {
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
                  {item.href === "/notifications" && unread > 0 && (
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
