"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Page } from "@/components/console/page";
import { WhenLoaded } from "@/components/admin/admin-status";
import { Callout } from "@/components/patterns/data-display";
import { Pill } from "@/components/patterns/status";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { effectiveGrants, ROLE_ORDER, teamsOf, type SecurityView } from "@/lib/admin-access";
import { useAgentStore } from "@/store/agent-store";

function Person({ view, member }: { view: SecurityView; member: SecurityView["memberships"][number] }) {
  const agents = useAgentStore((state) => state.agents);
  const teams = teamsOf(view, member.id);
  const grants = effectiveGrants(view, member.id);
  const agentName = (id: string) => agents.find((agent) => agent.id === id)?.view?.name ?? "Agent";
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex min-w-0 items-center gap-3 sm:w-64 sm:shrink-0">
        <span className="bg-brand-soft text-brand-text flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold uppercase" aria-hidden>{member.name.slice(0, 2)}</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{member.name}</p>
          <p className="text-xs text-muted-foreground capitalize">{member.role}</p>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5 text-sm">
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Teams</span>
          {teams.length ? teams.map((name) => <Pill key={name} tone="neutral">{name}</Pill>) : <span className="text-muted-foreground text-xs">none</span>}
        </p>
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Access</span>
          {member.role === "admin" ? <Pill tone="info">Every agent (administrator)</Pill>
            : grants.length === 0 ? <span className="text-danger text-xs">No grants, so no agents are visible</span>
            : grants.map((grant) => (
              <Pill key={grant.id} tone={grant.permission === "operate" ? "success" : "neutral"}>
                {agentName(grant.agentId)}{grant.skillId ? ` · ${grant.skillId}` : ""} · {grant.permission} <span className="opacity-70">via {grant.via === "team" ? grant.teamName : grant.via}</span>
              </Pill>
            ))}
        </p>
      </div>
    </li>
  );
}

export default function PeoplePage() {
  const [query, setQuery] = useState("");
  return (
    <Page title="People" description="Everyone in the organization, the teams they are in and what they can reach.">
      <WhenLoaded>
        {(view) => {
          const needle = query.trim().toLowerCase();
          const members = [...view.memberships]
            .filter((member) => !needle || member.name.toLowerCase().includes(needle) || member.role.includes(needle))
            .sort((a, b) => ROLE_ORDER.indexOf(a.role as typeof ROLE_ORDER[number]) - ROLE_ORDER.indexOf(b.role as typeof ROLE_ORDER[number]) || a.name.localeCompare(b.name));
          return (
            <div className="space-y-4">
              <Callout tone="info" title="Adding or removing people">
                People join by signing in with your identity provider, and an administrator provisions their role with <span className="font-mono">npm run auth:provision</span>.
                Change a role by running it again. Deactivating a person is a database change. This screen shows who is there and what they can reach; grant access on Teams and Agent access.
              </Callout>
              <InputGroup className="max-w-sm">
                <InputGroupAddon><Search /></InputGroupAddon>
                <InputGroupInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or role…" aria-label="Search people" />
              </InputGroup>
              {members.length === 0
                ? <p className="text-sm text-muted-foreground">{view.memberships.length ? "No one matches." : "No one has been provisioned yet."}</p>
                : <ul className="divide-y rounded-xl border bg-card" aria-label="People">{members.map((member) => <Person key={member.id} view={view} member={member} />)}</ul>}
            </div>
          );
        }}
      </WhenLoaded>
    </Page>
  );
}
