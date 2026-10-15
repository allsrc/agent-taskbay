"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Chip, EmptyState, InfoCard } from "@/components/a2a/primitives";
import { Page, PageMessage } from "@/components/console/page";
import { Callout } from "@/components/patterns/data-display";
import { DefinitionList } from "@/components/patterns/layout";
import { Eyebrow, Pill } from "@/components/patterns/status";
import { ConnectAgentDialog } from "@/components/agents/connect-agent-dialog";
import { ConnectionCard } from "@/components/agents/connection-card";
import { RequiredExtensionsNotice } from "@/components/agents/required-extensions-notice";
import { BrowseTasksDialog } from "@/components/agents/browse-tasks-dialog";
import { TaskDiscoveryCard } from "@/components/agents/task-discovery-card";
import type { DiscoveryStatusView } from "@/lib/browse-tasks";
import { useServerResource } from "@/lib/use-server-resource";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAgentStore } from "@/store/agent-store";

export default function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);
  const router = useRouter();
  const agent = useAgentStore((state) => state.agents.find((item) => item.id === agentId));
  const status = useAgentStore((state) => state.status);
  const refresh = useAgentStore((state) => state.refresh);
  const [connectOpen, setConnectOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const session = useServerResource<{ user: { role: string } }>("/api/auth/session");
  const discovery = useServerResource<DiscoveryStatusView>(`/api/agents/${agentId}/discovery`);

  if (!agent) {
    return status === "loading" || status === "idle" ? (
      <PageMessage>Loading agent…</PageMessage>
    ) : (
      <EmptyState icon={Trash2} title="Agent not found" action={<Link href="/agents" className={buttonVariants({ variant: "outline" })}>Back to agents</Link>} />
    );
  }

  const view = agent.view;

  async function remove() {
    if (!agent || !window.confirm("Remove this agent from the catalog?")) return;
    setRemoving(true);
    try {
      const response = await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Failed to remove the agent.");
      toast.success("Agent removed");
      await refresh();
      router.push("/agents");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove the agent.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Page
      detail
      size="wide"
      title={view?.name ?? "Unreachable agent"}
      description={view?.description ?? agent.error}
      eyebrow={view ? <Pill tone="success" dot live>Reachable · Agent Card v{view.version}</Pill> : <Pill tone="danger" dot>Discovery failed</Pill>}
      actions={
        <>
          {agent.source === "managed" && (
            <Button variant="outline" onClick={remove} disabled={removing}>
              {removing ? <Loader2 className="animate-spin" /> : <Trash2 />} Remove
            </Button>
          )}
          <Button variant="outline" onClick={() => setConnectOpen(true)}><Settings2 /> Connection setup</Button>
          {view && <Link href={`/chat?agent=${agent.id}`} className={buttonVariants()}><MessageSquare /> Start chat</Link>}
        </>
      }
    >
      {view && agent.extensions && (
        <div className="mb-4">
          <RequiredExtensionsNotice agentId={agent.id} unsupported={agent.extensions.unsupportedRequired} override={agent.extensions.override}
            admin={session.data?.user.role === "admin"} onChanged={refresh} />
        </div>
      )}
      {view ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {discovery.data && <TaskDiscoveryCard agentId={agent.id} status={discovery.data} admin={session.data?.user.role === "admin"} onChanged={discovery.refresh} onBrowse={() => setBrowseOpen(true)} />}

          <InfoCard label="Capabilities">
            <ul className="divide-y">
              {[
                ["Streaming", view.streaming],
                ["Push notifications", view.pushNotifications],
                ["Extended card", view.extendedCard],
              ].map(([key, on]) => (
                <li key={String(key)} className="flex items-center justify-between py-2 text-sm first:pt-0 last:pb-0">
                  <span>{String(key)}</span>
                  <Pill tone={on ? "success" : "neutral"}>{on ? "Yes" : "No"}</Pill>
                </li>
              ))}
            </ul>
            {view.extensions.length > 0 && (
              <div className="mt-4 space-y-1.5">
                <Eyebrow>Extensions</Eyebrow>
                {view.extensions.map((uri) => (
                  <span key={uri} className="block font-mono text-xs break-all text-muted-foreground">{uri}</span>
                ))}
              </div>
            )}
          </InfoCard>

          {agent.connection && <ConnectionCard connection={agent.connection} bindings={view.bindings} />}

          <InfoCard label="Skills">
            {view.skills.length === 0 && <p className="text-sm text-muted-foreground">No skills advertised.</p>}
            <ul className="divide-y">
              {view.skills.map((skill) => (
                <li key={skill.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="text-sm font-medium">{skill.name}</div>
                  <div className="text-sm text-muted-foreground">{skill.description}</div>
                </li>
              ))}
            </ul>
          </InfoCard>

          <InfoCard label="Security">
            <DefinitionList
              items={[
                { label: "Card signature", value: agent.trust ?? "unknown" },
                { label: "Authentication", value: view.security.length ? view.security.join(", ") : "None advertised" },
              ]}
            />
            <div className="mt-4 space-y-1.5">
              <Eyebrow>Default input modes</Eyebrow>
              <div className="flex flex-wrap gap-1.5">{view.inputModes.map((mode) => <Chip key={mode}>{mode}</Chip>)}</div>
            </div>
            <div className="mt-4 space-y-1.5">
              <Eyebrow>Default output modes</Eyebrow>
              <div className="flex flex-wrap gap-1.5">{view.outputModes.map((mode) => <Chip key={mode}>{mode}</Chip>)}</div>
            </div>
          </InfoCard>
        </div>
      ) : (
        <Callout tone="danger" title="This agent could not be reached"><span className="font-mono">{agent.error}</span></Callout>
      )}
      {view && <BrowseTasksDialog agentId={agent.id} agentName={view.name} tenants={agent.connection?.tenants ?? (view.tenant ? [view.tenant] : [])} open={browseOpen} onOpenChange={setBrowseOpen} />}
      <ConnectAgentDialog open={connectOpen} onOpenChange={setConnectOpen} initialUrl={agent.cardUrl} />
    </Page>
  );
}
