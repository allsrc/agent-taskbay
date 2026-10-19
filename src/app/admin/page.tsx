"use client";

import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, KeyRound, Users, UsersRound } from "lucide-react";
import { Page } from "@/components/console/page";
import { WhenLoaded } from "@/components/admin/admin-status";
import { StatTile } from "@/components/patterns/data-display";
import { cardSurface } from "@/components/patterns/card-surface";
import { overviewCounts, ROLE_HELP, ROLE_ORDER } from "@/lib/admin-access";
import { useAgentStore } from "@/store/agent-store";
import { cn } from "@/lib/utils";

const SHORTCUTS = [
  { href: "/admin/people", icon: Users, title: "People", text: "Who can sign in, their role and what they can reach." },
  { href: "/admin/teams", icon: UsersRound, title: "Teams", text: "Group people so one grant covers them all." },
  { href: "/admin/access", icon: KeyRound, title: "Agent access", text: "Grant read or operate on an agent or one skill, and check credentials." },
];

export default function AdminOverviewPage() {
  const agents = useAgentStore((state) => state.agents);
  return (
    <Page title="Organization" description="Who is in your organization and which agents they can reach.">
      <WhenLoaded>
        {(view) => {
          const counts = overviewCounts(view);
          const unreachable = agents.filter((agent) => !agent.view).length;
          return (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="People" value={counts.people} icon={Users} />
                <StatTile label="Teams" value={counts.teams} icon={UsersRound} />
                <StatTile label="Active grants" value={counts.grants} icon={KeyRound} />
                <StatTile label="Agents" value={agents.length} unit={unreachable ? `${unreachable} unreachable` : undefined} />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {SHORTCUTS.map((item) => (
                  <Link key={item.href} href={item.href as Route} className={cn(cardSurface, "flex flex-col gap-2 p-4")}>
                    <span className="flex items-center gap-2 text-sm font-medium"><item.icon className="size-4 text-brand-text" /> {item.title}<ArrowRight className="text-muted-foreground ml-auto size-4" /></span>
                    <span className="text-sm text-muted-foreground">{item.text}</span>
                  </Link>
                ))}
              </div>
              <section className="space-y-2">
                <h2 className="font-heading text-base font-semibold">Roles</h2>
                <ul className="divide-y rounded-xl border bg-card">
                  {ROLE_ORDER.map((role) => (
                    <li key={role} className="flex items-start gap-3 px-4 py-3 text-sm">
                      <span className="w-20 shrink-0 font-medium capitalize">{role}</span>
                      <span className="min-w-0 flex-1 text-muted-foreground">{ROLE_HELP[role]}</span>
                      <span className="font-mono text-xs text-muted-foreground">{counts.byRole[role]}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          );
        }}
      </WhenLoaded>
    </Page>
  );
}
