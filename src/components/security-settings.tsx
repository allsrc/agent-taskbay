"use client";
import { useCallback, useEffect, useState } from "react";
import { InfoCard } from "./a2a/primitives";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useAgentStore } from "@/store/agent-store";

interface SecurityView {
  organizationId: string;
  teams: Array<{id: string; name: string; enabled: boolean}>;
  memberships: Array<{id: string; name: string; role: string}>;
  teamMembers: Array<{id: string; teamId: string; membershipId: string}>;
  grants: Array<{id: string; subjectType: string; subjectId: string; agentId: string; skillId: string | null; permission: string; enabled: boolean}>;
  credentials: Array<{agentId: string; kind: string; enabled: boolean; updatedAt: string}>;
}
async function loadSecurity(): Promise<SecurityView | undefined> {
  const response = await fetch("/api/admin/security", {cache: "no-store"});
  if (response.status === 403) return;
  if (!response.ok) throw new Error("Could not load access settings.");
  return response.json();
}
export function SecuritySettings() {
  const [data,setData] = useState<SecurityView>();
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [agentId,setAgentId] = useState("");
  const agents = useAgentStore((state) => state.agents);
  const refresh = useCallback(async () => {
    const value = await loadSecurity();
    if (value) setData(value);
  }, []);
  useEffect(() => {
    let active = true;
    void loadSecurity().then((value) => {if (active && value) setData(value);})
      .catch(() => {if (active) setError("Could not load access settings.");});
    return () => {active = false;};
  }, []);
  async function change(input: Record<string, unknown>) {
    setBusy(true);setError("");
    try {
      const response = await fetch("/api/admin/security", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(input)});
      if (!response.ok) throw new Error((await response.json()).error?.message ?? "Could not update access.");
      await refresh();
    } catch (cause) {setError(cause instanceof Error ? cause.message : "Could not update access.");}
    finally {setBusy(false);}
  }
  if (!data) return error ? <p role="alert">{error}</p> : null;
  const selectClass = "border-border bg-background w-full rounded-md border px-2 py-1 text-sm";
  const selected = agents.find((agent) => agent.id === agentId);
  const nameFor = (type: string,id: string) => type === "organization" ? "Everyone in organization" :
    type === "team" ? data.teams.find((team) => team.id === id)?.name ?? id : data.memberships.find((member) => member.id === id)?.name ?? id;
  return <>
    <InfoCard label="Teams and access">
      <p className="text-muted-foreground mb-3 text-xs">Users need an explicit agent or skill grant. Administrators manage the full organization.</p>
      {error && <p role="alert" className="text-destructive mb-2">{error}</p>}
      <form className="mb-3 flex gap-2" onSubmit={(event) => {event.preventDefault();const form = new FormData(event.currentTarget);void change({action: "createTeam",name: form.get("name")});}}>
        <Input name="name" placeholder="Team name" aria-label="Team name" required maxLength={200}/><Button disabled={busy}>Create team</Button>
      </form>
      <form className="mb-3 grid gap-2" onSubmit={(event) => {event.preventDefault();const form=new FormData(event.currentTarget);void change({action: "addTeamMember",teamId:form.get("teamId"),membershipId:form.get("membershipId")});}}>
        <select name="teamId" aria-label="Team" required className={selectClass}><option value="">Choose team</option>{data.teams.filter((team) => team.enabled).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
        <select name="membershipId" aria-label="Team member" required className={selectClass}><option value="">Choose member</option>{data.memberships.map((member) => <option key={member.id} value={member.id}>{member.name} ({member.role})</option>)}</select>
        <Button disabled={busy}>Add member</Button>
      </form>
      {data.teamMembers.map((link) => <div key={link.id} className="mb-2 flex items-center justify-between gap-2 text-xs"><span>{nameFor("team",link.teamId)} · {nameFor("membership",link.membershipId)}</span><Button variant="ghost" disabled={busy} onClick={() => void change({action: "removeTeamMember",teamId:link.teamId,membershipId:link.membershipId})}>Remove</Button></div>)}
      <form className="grid gap-2 border-t pt-3" onSubmit={(event) => {
        event.preventDefault();const form=new FormData(event.currentTarget);const [subjectType,subjectId] = String(form.get("subject")).split(":");
        void change({action: "grant",subjectType,subjectId,agentId:form.get("agentId"),skillId:form.get("skillId") || null,permission:form.get("permission")});
      }}>
        <select name="subject" aria-label="Grant recipient" className={selectClass}><option value={`organization:${data.organizationId}`}>Everyone in organization</option>{data.memberships.map((member) => <option key={member.id} value={`membership:${member.id}`}>{member.name}</option>)}{data.teams.filter((team) => team.enabled).map((team) => <option key={team.id} value={`team:${team.id}`}>Team: {team.name}</option>)}</select>
        <select name="agentId" aria-label="Grant agent" value={agentId} onChange={(event) => setAgentId(event.target.value)} required className={selectClass}><option value="">Choose agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.view?.name ?? agent.cardUrl}</option>)}</select>
        <select key={agentId} name="skillId" aria-label="Grant scope" className={selectClass}><option value="">Whole agent</option>{selected?.view?.skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select>
        <select name="permission" aria-label="Grant permission" className={selectClass}><option value="read">Read</option><option value="operate">Read and operate</option></select>
        <Button disabled={busy}>Grant access</Button>
      </form>
      <p className="text-muted-foreground mt-2 text-xs">Skill-only operations require the agent to support bounded skill routing.</p>
      {data.grants.filter((grant) => grant.enabled).map((grant) => <div key={grant.id} className="mt-2 flex items-center justify-between gap-2 border-t pt-2 text-xs"><span>{nameFor(grant.subjectType,grant.subjectId)} · {agents.find((agent) => agent.id === grant.agentId)?.view?.name ?? grant.agentId} · {grant.skillId ?? "whole agent"} · {grant.permission}</span><Button variant="ghost" disabled={busy} onClick={() => void change({action:"revokeGrant",grantId:grant.id})}>Revoke</Button></div>)}
    </InfoCard>
    <InfoCard label="Agent credentials">
      <p className="text-muted-foreground text-xs">Provision and rotate encrypted credentials on the server with security:credentials. Secret values are never returned here.</p>
      {agents.map((agent) => {
        const credential=data.credentials.find((item) => item.agentId === agent.id);
        return <div key={agent.id} className="mt-2 flex justify-between gap-2 border-t pt-2 text-xs"><span>{agent.view?.name ?? agent.cardUrl}</span><span>{credential ? `${credential.kind} · ${credential.enabled ? "configured" : "revoked"}` : "unconfigured"}</span></div>;
      })}
    </InfoCard>
  </>;
}
