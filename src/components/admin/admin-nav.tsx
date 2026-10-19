"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { Bell, KeyRound, LayoutDashboard, ScrollText, ShieldCheck, Users, UsersRound, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface AdminLink { href: Route; label: string; icon: LucideIcon; exact?: boolean }

export const ADMIN_LINKS: AdminLink[] = [
  { href: "/admin" as Route, label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/people" as Route, label: "People", icon: Users },
  { href: "/admin/teams" as Route, label: "Teams", icon: UsersRound },
  { href: "/admin/access" as Route, label: "Agent access", icon: KeyRound },
  { href: "/admin/policies" as Route, label: "Policies & alerts", icon: Bell },
  { href: "/audit" as Route, label: "Audit trail", icon: ScrollText },
];

/** The sub-navigation of the Admin area: one tab per job, scrolling sideways on a phone. */
export function AdminNav() {
  const pathname = usePathname() ?? "";
  return (
    <div className="shrink-0 border-b bg-background">
      <div className="flex items-center gap-2 px-4 pt-3 text-xs font-medium text-muted-foreground md:px-6">
        <ShieldCheck className="size-3.5" /> Administration
      </div>
      <nav aria-label="Administration" className="flex gap-1 overflow-x-auto px-3 pb-2 pt-1 md:px-5">
        {ADMIN_LINKS.map((link) => {
          const on = link.exact ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={on ? "page" : undefined}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                on ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <link.icon className={cn("size-4", on && "text-brand-text")} /> {link.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
