"use client";

import { use, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Chip, EmptyState, InfoCard } from "@/components/a2a/primitives";
import { Page, PageMessage } from "@/components/console/page";
import { Callout } from "@/components/patterns/data-display";
import { DefinitionList } from "@/components/patterns/layout";
import { Eyebrow, Pill } from "@/components/patterns/status";
import { ConnectAgentDialog } from "@/components/agents/connect-agent-dialog";
import { AgentNicknameCard } from "@/components/agents/agent-nickname-card";
import { ConnectionCard } from "@/components/agents/connection-card";
import { RequiredExtensionsNotice } from "@/components/agents/required-extensions-notice";
import { TaskDiscoveryCard } from "@/components/agents/task-discovery-card";
import { ExtendedCardRow } from "@/components/agents/extended-card-row";
import { mergeExtendedSkills } from "@/lib/extended-card";
import type { DiscoveryStatusView } from "@/lib/browse-tasks";
import { useServerResource } from "@/lib/use-server-resource";
import { Button, buttonVariants } from "@/components/ui/button";
import { advertisedName, useAgentStore } from "@/store/agent-store";

export default function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);
  const router = useRouter();
  const agent = useAgentStore((state) => state.agents.find((item) => item.id === agentId));
  const status = useAgentStore((state) => state.status);
  const refresh = useAgentStore((state) => state.refresh);
  const [connectOpen, setConnectOpen] = useState(false);
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
  const skills = view ? mergeExtendedSkills(view.skills, agent.extendedCard) : [];

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
      title={view?.name ?? agent.nickname ?? "Unreachable agent"}
      description={[advertisedName(agent) && `Card name: ${advertisedName(agent)}`, view?.description ?? agent.error].filter(Boolean).join(" · ")}
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
          <AgentNicknameCard agentId={agent.id} nickname={agent.nickname} cardName={agent.cardName} admin={session.data?.user.role === "admin"} onChanged={refresh} />
          {discovery.data && <TaskDiscoveryCard agentId={agent.id} status={discovery.data} admin={session.data?.user.role === "admin"} onChanged={discovery.refresh} onBrowse={() => router.push(`/discover?agent=${agent.id}` as Route)} />}

          <InfoCard label="Capabilities">
            <ul className="divide-y">
              {[
                ["Streaming", view.streaming],
                ["Push notifications", view.pushNotifications],
              ].map(([key, on]) => (
                <li key={String(key)} className="flex items-center justify-between py-2 text-sm first:pt-0 last:pb-0">
                  <span>{String(key)}</span>
                  <Pill tone={on ? "success" : "neutral"}>{on ? "Yes" : "No"}</Pill>
                </li>
              ))}
              <ExtendedCardRow agentId={agent.id} advertised={view.extendedCard} admin={session.data?.user.role === "admin"}
                card={agent.extendedCard} onChanged={refresh} />
            </ul>
            {agent.extendedCard && <p className="mt-3 text-sm text-muted-foreground">
              Authenticated capabilities: streaming {agent.extendedCard.capabilities.streaming ? "yes" : "no"}, push notifications {agent.extendedCard.capabilities.pushNotifications ? "yes" : "no"}. Used for display only.
            </p>}
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
            {skills.length === 0 && <p className="text-sm text-muted-foreground">No skills advertised.</p>}
            <ul className="divide-y">
              {skills.map((skill) => (
                <li key={skill.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{skill.name}{skill.authenticated && <Pill tone="info">Authenticated</Pill>}</div>
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
        <div className="grid gap-4">
          <Callout tone="danger" title="This agent could not be reached"><span className="font-mono">{agent.error}</span></Callout>
          <AgentNicknameCard agentId={agent.id} nickname={agent.nickname} admin={session.data?.user.role === "admin"} onChanged={refresh} />
        </div>
      )}
      <ConnectAgentDialog open={connectOpen} onOpenChange={setConnectOpen} initialUrl={agent.cardUrl} />
    </Page>
  );
}
