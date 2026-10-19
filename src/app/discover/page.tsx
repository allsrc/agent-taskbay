"use client";

import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { SearchCheck } from "lucide-react";
import { AgentAvatar, EmptyState } from "@/components/a2a/primitives";
import { BrowseTasksPanel } from "@/components/agents/browse-tasks-panel";
import { Page, PageMessage } from "@/components/console/page";
import { Callout } from "@/components/patterns/data-display";
import { buttonVariants } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { DiscoveryStatusView } from "@/lib/browse-tasks";
import { useServerResource } from "@/lib/use-server-resource";
import { useAgentStore } from "@/store/agent-store";

function Browse({ agentId }: { agentId: string }) {
  const agent = useAgentStore((state) => state.agents.find((item) => item.id === agentId));
  const discovery = useServerResource<DiscoveryStatusView>(`/api/agents/${agentId}/discovery`);
  if (!agent?.view) return <Callout tone="danger" title="This agent could not be reached"><span className="font-mono">{agent?.error ?? "Discovery failed."}</span></Callout>;
  if (discovery.loading) return <PageMessage>Checking what this agent allows…</PageMessage>;
  if (!discovery.data?.canBrowse) {
    return (
      <Callout tone="warning" title="You can't browse this agent's tasks"
        action={<Link href={`/agents/${agentId}` as Route} className={buttonVariants({ variant: "outline", size: "sm" })}>Agent settings</Link>}>
        {discovery.data?.effectiveMode === "off" ? "Task discovery is off for this agent. An administrator can turn it on in the agent's settings." : "Browsing needs an operator or administrator with access to the whole agent, not one skill."}
      </Callout>
    );
  }
  return <BrowseTasksPanel key={agentId} agentId={agentId} tenants={agent.connection?.tenants ?? (agent.view.tenant ? [agent.view.tenant] : [])} />;
}

function Find() {
  const router = useRouter();
  const params = useSearchParams();
  const agents = useAgentStore((state) => state.agents);
  const status = useAgentStore((state) => state.status);
  const reachable = agents.filter((agent) => agent.view);
  const agentId = params.get("agent") ?? reachable[0]?.id ?? "";
  const loading = (status === "idle" || status === "loading") && agents.length === 0;

  return (
    <Page
      size="wide"
      title="Find tasks"
      description="Read the task list straight from an agent to find work another system started. Nothing is stored until you track a task, and then it joins your Tasks and Inbox."
      actions={<Link href={"/tasks" as Route} className={buttonVariants({ variant: "outline" })}>Back to tasks</Link>}
    >
      {loading ? <PageMessage>Loading agents…</PageMessage> : reachable.length === 0 ? (
        <EmptyState icon={SearchCheck} title="No reachable agents" action={<Link href={"/agents" as Route} className={buttonVariants()}>Go to agents</Link>}>
          Connect an agent first, then come back to find the tasks it already has.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <label className="flex max-w-sm items-center gap-3 text-sm">
            <AgentAvatar name={agents.find((agent) => agent.id === agentId)?.view?.name ?? "Agent"} id={agentId} />
            <NativeSelect value={agentId} aria-label="Agent" onChange={(event) => router.replace(`/discover?agent=${encodeURIComponent(event.target.value)}` as Route)}>
              {reachable.map((agent) => <option key={agent.id} value={agent.id}>{agent.view?.name}</option>)}
            </NativeSelect>
          </label>
          <Browse agentId={agentId} />
        </div>
      )}
    </Page>
  );
}

export default function DiscoverPage() {
  return <Suspense fallback={<PageMessage>Loading…</PageMessage>}><Find /></Suspense>;
}
