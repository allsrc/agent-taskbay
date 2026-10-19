"use client";

import { useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { Page } from "@/components/console/page";
import { useAdminData } from "@/components/admin/admin-data";
import { ErrorLine, WhenLoaded } from "@/components/admin/admin-status";
import { Callout } from "@/components/patterns/data-display";
import { Pill } from "@/components/patterns/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { effectiveGrants, ROLE_HELP, ROLE_ORDER, teamsOf, type SecurityView } from "@/lib/admin-access";
import { useAgentStore } from "@/store/agent-store";

type Member = SecurityView["memberships"][number];

function AddPerson({ issuer }: { issuer: string | null }) {
  const { change, busy } = useAdminData();
  const [open, setOpen] = useState(false);
  if (!open) return <Button onClick={() => setOpen(true)}><UserPlus /> Add person</Button>;
  return (
    <form className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void change({ action: "provisionMember", subject: form.get("subject"), displayName: form.get("displayName"), role: form.get("role") }).then((ok) => ok && setOpen(false));
    }}>
      <div className="space-y-1.5"><Label htmlFor="person-name">Name</Label><Input id="person-name" name="displayName" required maxLength={200} placeholder="Ada Lovelace" /></div>
      <div className="space-y-1.5">
        <Label htmlFor="person-subject">Identity-provider subject</Label>
        <Input id="person-subject" name="subject" required maxLength={255} className="font-mono text-xs" placeholder="The exact `sub` claim" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="person-role">Role</Label>
        <NativeSelect id="person-role" name="role" defaultValue="viewer">
          {ROLE_ORDER.map((role) => <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}: {ROLE_HELP[role]}</option>)}
        </NativeSelect>
      </div>
      <p className="text-xs text-muted-foreground sm:self-end">
        They can sign in as soon as you add them, through <span className="font-mono">{issuer}</span>. A new operator or viewer sees no agents until you grant access.
        Adding someone who is already here changes their role and turns them back on.
      </p>
      <div className="flex gap-2 sm:col-span-2">
        <Button disabled={busy}>Add person</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

function Person({ view, member, manage }: { view: SecurityView; member: Member; manage: boolean }) {
  const { change, busy } = useAdminData();
  const agents = useAgentStore((state) => state.agents);
  const self = member.id === view.identity.selfMembershipId;
  const teams = teamsOf(view, member.id);
  const grants = effectiveGrants(view, member.id);
  const agentName = (id: string) => agents.find((agent) => agent.id === id)?.view?.name ?? "Agent";
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex min-w-0 items-center gap-3 sm:w-64 sm:shrink-0">
        <span className="bg-brand-soft text-brand-text flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold uppercase" aria-hidden>{member.name.slice(0, 2)}</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{member.name}{self && <span className="text-muted-foreground font-normal"> (you)</span>}</p>
          {manage && !self ? (
            <NativeSelect value={member.role} disabled={busy} aria-label={`Role of ${member.name}`} className="mt-0.5 h-7 text-xs"
              onChange={(event) => void change({ action: "changeRole", membershipId: member.id, role: event.target.value })}>
              {ROLE_ORDER.map((role) => <option key={role} value={role}>{role}</option>)}
            </NativeSelect>
          ) : <p className="text-xs text-muted-foreground capitalize">{member.role}</p>}
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
      {manage && !self && (
        <Button variant="outline" size="sm" disabled={busy} className="sm:self-start"
          onClick={() => { if (window.confirm(`Deactivate ${member.name}? They are signed out now and can't sign in. Their tasks and audit history stay.`)) void change({ action: "deactivateMember", membershipId: member.id }); }}>
          Deactivate
        </Button>
      )}
    </li>
  );
}

export default function PeoplePage() {
  const { change, busy } = useAdminData();
  const [query, setQuery] = useState("");
  return (
    <Page title="People" description="Everyone in the organization, the teams they are in and what they can reach.">
      <WhenLoaded>
        {(view) => {
          const manage = view.identity.mode === "oidc";
          const needle = query.trim().toLowerCase();
          const members = [...view.memberships]
            .filter((member) => !needle || member.name.toLowerCase().includes(needle) || member.role.includes(needle))
            .sort((a, b) => ROLE_ORDER.indexOf(a.role as typeof ROLE_ORDER[number]) - ROLE_ORDER.indexOf(b.role as typeof ROLE_ORDER[number]) || a.name.localeCompare(b.name));
          return (
            <div className="space-y-4">
              <ErrorLine />
              {manage ? <AddPerson issuer={view.identity.issuer} /> : (
                <Callout tone="info" title="Local development mode">
                  This console is signed in as one built-in administrator, so there is nobody else to manage. Run it with OIDC sign-in (see{" "}
                  <span className="font-mono">docs/guides/sign-in-and-roles.md</span>) to add people, set roles and deactivate accounts here.
                </Callout>
              )}
              <InputGroup className="max-w-sm">
                <InputGroupAddon><Search /></InputGroupAddon>
                <InputGroupInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or role…" aria-label="Search people" />
              </InputGroup>
              {members.length === 0
                ? <p className="text-sm text-muted-foreground">{view.memberships.length ? "No one matches." : "No one has been added yet."}</p>
                : <ul className="divide-y rounded-xl border bg-card" aria-label="People">{members.map((member) => <Person key={member.id} view={view} member={member} manage={manage} />)}</ul>}
              {manage && view.inactiveMemberships.length > 0 && (
                <section className="space-y-2">
                  <h2 className="font-heading text-base font-semibold">Deactivated</h2>
                  <ul className="divide-y rounded-xl border bg-card" aria-label="Deactivated people">
                    {view.inactiveMemberships.map((member) => (
                      <li key={member.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <span className="min-w-0 flex-1 truncate">{member.name} <span className="text-muted-foreground text-xs capitalize">{member.role}</span></span>
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => void change({ action: "reactivateMember", membershipId: member.id })}>Reactivate</Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          );
        }}
      </WhenLoaded>
    </Page>
  );
}
