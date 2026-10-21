"use client";

import { useState } from "react";
import { Page } from "@/components/console/page";
import { useAdminData } from "@/components/admin/admin-data";
import { ErrorLine, WhenLoaded } from "@/components/admin/admin-status";
import { Panel } from "@/components/patterns/layout";
import { Pill } from "@/components/patterns/status";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { recipientName } from "@/lib/admin-access";
import { agentOptionLabel, useAgentStore } from "@/store/agent-store";

export default function AgentAccessPage() {
  const { change, busy } = useAdminData();
  const agents = useAgentStore((state) => state.agents);
  const [agentId, setAgentId] = useState("");
  const selected = agents.find((agent) => agent.id === agentId);
  const agentName = (id: string) => agents.find((agent) => agent.id === id)?.view?.name ?? id;
  return (
    <Page title="Agent access" description="Operators and viewers see only the agents they are granted. Administrators reach every agent.">
      <WhenLoaded>
        {(view) => {
          const active = view.grants.filter((grant) => grant.enabled);
          return (
            <div className="space-y-4">
              <ErrorLine />
              <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
                <Panel title="Grant access">
                  <form className="grid gap-2" onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const [subjectType, subjectId] = String(form.get("subject")).split(":");
                    void change({ action: "grant", subjectType, subjectId, agentId: form.get("agentId"), skillId: form.get("skillId") || null, permission: form.get("permission") });
                  }}>
                    <NativeSelect name="subject" aria-label="Grant recipient">
                      <option value={`organization:${view.organizationId}`}>Everyone in the organization</option>
                      {view.memberships.map((member) => <option key={member.id} value={`membership:${member.id}`}>{member.name}</option>)}
                      {view.teams.filter((team) => team.enabled).map((team) => <option key={team.id} value={`team:${team.id}`}>Team: {team.name}</option>)}
                    </NativeSelect>
                    <NativeSelect name="agentId" aria-label="Grant agent" value={agentId} onChange={(event) => setAgentId(event.target.value)} required>
                      <option value="">Choose agent</option>
                      {agents.map((agent) => <option key={agent.id} value={agent.id}>{agentOptionLabel(agent, agent.cardUrl)}</option>)}
                    </NativeSelect>
                    <NativeSelect key={agentId} name="skillId" aria-label="Grant scope">
                      <option value="">Whole agent</option>
                      {selected?.view?.skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
                    </NativeSelect>
                    <NativeSelect name="permission" aria-label="Grant permission"><option value="read">Read</option><option value="operate">Read and operate</option></NativeSelect>
                    <Button disabled={busy}>Grant access</Button>
                    <p className="text-muted-foreground text-xs">Skill-only operations require the agent to support bounded skill routing.</p>
                  </form>
                </Panel>

                <Panel title="Agent credentials" description="Set and rotate on the server with security:credentials. Secret values are never shown.">
                  <ul className="divide-y">
                    {agents.length === 0 && <li className="text-sm text-muted-foreground">No agents connected.</li>}
                    {agents.map((agent) => {
                      const credential = view.credentials.find((item) => item.agentId === agent.id);
                      return (
                        <li key={agent.id} className="flex items-center justify-between gap-2 py-2 text-sm first:pt-0 last:pb-0">
                          <span className="min-w-0 truncate">{agentOptionLabel(agent, agent.cardUrl)}</span>
                          {credential ? <Pill tone={credential.enabled ? "success" : "danger"}>{credential.kind} · {credential.enabled ? "configured" : "revoked"}</Pill> : <Pill tone="neutral">none</Pill>}
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
              </div>

              <Panel title="Active grants" description={`${active.length} in effect`} bodyClassName="p-0 sm:p-0">
                {active.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No grants yet. Until you add one, operators and viewers see no agents.</p> : (
                  <ul className="divide-y">
                    {active.map((grant) => (
                      <li key={grant.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{agentName(grant.agentId)}<span className="text-muted-foreground font-normal"> · {grant.skillId ?? "whole agent"}</span></p>
                          <p className="truncate text-xs text-muted-foreground">{recipientName(view, grant)}</p>
                        </div>
                        <Pill tone={grant.permission === "operate" ? "success" : "neutral"}>{grant.permission}</Pill>
                        <Button variant="outline" size="xs" disabled={busy} onClick={() => void change({ action: "revokeGrant", grantId: grant.id })}>Revoke</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          );
        }}
      </WhenLoaded>
    </Page>
  );
}
