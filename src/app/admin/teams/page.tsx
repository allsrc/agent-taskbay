"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Page } from "@/components/console/page";
import { useAdminData } from "@/components/admin/admin-data";
import { ErrorLine, WhenLoaded } from "@/components/admin/admin-status";
import { Panel } from "@/components/patterns/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export default function TeamsPage() {
  const { change, busy } = useAdminData();
  const [name, setName] = useState("");
  return (
    <Page title="Teams" description="A team is a group of people. Give the team a grant once and everyone in it gets that access.">
      <WhenLoaded>
        {(view) => (
          <div className="space-y-4">
            <ErrorLine />
            <form className="flex max-w-md gap-2" onSubmit={(event) => { event.preventDefault(); if (name.trim()) void change({ action: "createTeam", name: name.trim() }).then((ok) => ok && setName("")); }}>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="New team name" aria-label="Team name" required maxLength={200} />
              <Button disabled={busy}><Plus /> Create team</Button>
            </form>
            {view.teams.filter((team) => team.enabled).length === 0 && <p className="text-sm text-muted-foreground">No teams yet.</p>}
            <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
              {view.teams.filter((team) => team.enabled).map((team) => {
                const members = view.teamMembers.filter((link) => link.teamId === team.id);
                const candidates = view.memberships.filter((member) => !members.some((link) => link.membershipId === member.id));
                return (
                  <Panel key={team.id} title={team.name} description={`${members.length} ${members.length === 1 ? "person" : "people"}`}
                    action={<Button variant="ghost" size="sm" disabled={busy} onClick={() => { if (window.confirm(`Disable team “${team.name}”? Its grants stop applying.`)) void change({ action: "disableTeam", teamId: team.id }); }}>Disable</Button>}>
                    <ul className="mb-3 divide-y" aria-label={`Members of ${team.name}`}>
                      {members.length === 0 && <li className="text-sm text-muted-foreground">No members yet.</li>}
                      {members.map((link) => {
                        const member = view.memberships.find((item) => item.id === link.membershipId);
                        return (
                          <li key={link.id} className="flex items-center gap-2 py-1.5 text-sm first:pt-0">
                            <span className="min-w-0 flex-1 truncate">{member?.name ?? "Unknown"} <span className="text-muted-foreground text-xs">{member?.role}</span></span>
                            <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`Remove ${member?.name ?? "member"} from ${team.name}`}
                              onClick={() => void change({ action: "removeTeamMember", teamId: team.id, membershipId: link.membershipId })}><X /></Button>
                          </li>
                        );
                      })}
                    </ul>
                    {candidates.length > 0 && (
                      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); const id = String(new FormData(event.currentTarget).get("membershipId")); if (id) void change({ action: "addTeamMember", teamId: team.id, membershipId: id }); }}>
                        <NativeSelect name="membershipId" aria-label={`Add to ${team.name}`} defaultValue="" required>
                          <option value="">Add a person…</option>
                          {candidates.map((member) => <option key={member.id} value={member.id}>{member.name} ({member.role})</option>)}
                        </NativeSelect>
                        <Button variant="outline" disabled={busy}>Add</Button>
                      </form>
                    )}
                  </Panel>
                );
              })}
            </div>
          </div>
        )}
      </WhenLoaded>
    </Page>
  );
}
