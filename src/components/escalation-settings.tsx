"use client";
import { useCallback, useEffect, useState } from "react";
import { InfoCard } from "./a2a/primitives";
import { Button } from "./ui/button";
import { useAgentStore } from "@/store/agent-store";
import type { EscalationPolicyView } from "@/shared/workflow-types";

interface PolicyData { policies: EscalationPolicyView[]; people: Record<string, string> }
interface Member { id: string; name: string; role: string }

interface Loaded { policies: PolicyData; members: Member[] }
async function loadPolicies(): Promise<Loaded | undefined> {
  const [policies, security] = await Promise.all([fetch("/api/escalation-policies", { cache: "no-store" }), fetch("/api/admin/security", { cache: "no-store" })]);
  if (policies.status === 403 || security.status === 403) return;
  if (!policies.ok || !security.ok) throw new Error("Could not load escalation settings.");
  return { policies: await policies.json(), members: ((await security.json()).memberships as Member[]).filter((member) => ["admin", "operator"].includes(member.role)) };
}

/** Administrator-only: where overdue, owned work goes. Other roles never see this card (the API answers 403). */
export function EscalationSettings() {
  const [data, setData] = useState<PolicyData>();
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const agents = useAgentStore((state) => state.agents);

  const apply = useCallback((value: Loaded | undefined) => { if (value) { setData(value.policies); setMembers(value.members); } }, []);
  useEffect(() => {
    let active = true;
    void loadPolicies().then((value) => { if (active) apply(value); }).catch(() => { if (active) setError("Could not load escalation settings."); });
    return () => { active = false; };
  }, [apply]);

  async function save(input: { agentId: string | null; targetMembershipId: string; enabled: boolean }) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/escalation-policies", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      if (!response.ok) throw new Error((await response.json()).error?.message ?? "Could not save the policy.");
      apply(await loadPolicies());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the policy."); }
    finally { setBusy(false); }
  }
  if (!data) return error ? <p role="alert">{error}</p> : null;
  const selectClass = "border-border bg-background w-full rounded-md border px-2 py-1 text-sm";
  const scopeName = (agentId: string | null) => agentId === null ? "All agents" : agents.find((agent) => agent.id === agentId)?.view?.name ?? "Agent";

  return (
    <InfoCard label="Escalation">
      <p className="text-muted-foreground mb-3 text-xs">When owned work passes its due time, it is handed to this reviewer once per due time. An agent-specific rule overrides “All agents”. Without a rule, overdue work is only flagged.</p>
      {error && <p role="alert" className="text-destructive mb-2">{error}</p>}
      <ul className="mb-3" aria-label="Escalation rules">
        {data.policies.length === 0 && <li className="text-muted-foreground text-[13px]">No escalation rules yet.</li>}
        {data.policies.map((policy) => (
          <li key={policy.id} className="border-border flex items-center gap-2 border-t py-2 first:border-t-0">
            <span className="min-w-0 flex-1 text-[13px]"><span className="font-medium">{scopeName(policy.agentId)}</span> → {data.people[policy.targetMembershipId] ?? "Unknown reviewer"}
              {!policy.enabled && <span className="text-muted-foreground"> (off)</span>}</span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => save({ agentId: policy.agentId, targetMembershipId: policy.targetMembershipId, enabled: !policy.enabled })}>
              {policy.enabled ? "Turn off" : "Turn on"}</Button>
          </li>
        ))}
      </ul>
      <form className="grid gap-2" onSubmit={(event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        void save({ agentId: String(form.get("agentId")) || null, targetMembershipId: String(form.get("targetMembershipId")), enabled: true });
      }}>
        <select name="agentId" aria-label="Applies to" className={selectClass} defaultValue="">
          <option value="">All agents</option>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.view?.name ?? agent.id}</option>)}
        </select>
        <select name="targetMembershipId" aria-label="Escalate to" required className={selectClass} defaultValue="">
          <option value="">Escalate to…</option>
          {members.map((member) => <option key={member.id} value={member.id}>{member.name} ({member.role})</option>)}
        </select>
        <Button disabled={busy}>Save rule</Button>
      </form>
    </InfoCard>
  );
}
