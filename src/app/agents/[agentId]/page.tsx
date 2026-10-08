"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AgentAvatar, BackLink, Chip, EmptyState, InfoCard } from "@/components/a2a/primitives";
import { ConnectAgentDialog } from "@/components/agents/connect-agent-dialog";
import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/store/agent-store";
import { cn } from "@/lib/utils";

export default function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);
  const router = useRouter();
  const agent = useAgentStore((state) => state.agents.find((item) => item.id === agentId));
  const status = useAgentStore((state) => state.status);
  const refresh = useAgentStore((state) => state.refresh);
  const [connectOpen, setConnectOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  if (!agent) {
    return status === "loading" || status === "idle" ? (
      <div className="text-muted-foreground flex items-center gap-2 p-6 font-mono text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading agent…
      </div>
    ) : (
      <EmptyState icon={<Trash2 className="size-7" />} title="Agent not found">
        <Link href="/agents" className="text-primary hover:underline">
          Back to agents
        </Link>
      </EmptyState>
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
    <div className="min-h-0 flex-1 overflow-auto p-4 pb-24 md:p-6">
      <BackLink href="/agents">Agents</BackLink>
      <div className="flex flex-wrap items-center gap-3.5">
        <AgentAvatar name={view?.name ?? "Agent"} id={agent.id} size="lg" />
        <div className="min-w-44 flex-1">
          <h2 className="font-mono text-[22px] leading-tight font-bold tracking-tight">{view?.name ?? "Unreachable agent"}</h2>
          <p className="text-muted-foreground mt-0.5">{view?.description ?? agent.error}</p>
        </div>
      </div>

      <div className="mt-4 mb-5 flex flex-wrap gap-2">
        {view && (
          <Button variant="brand" size="lg" asChild>
            <Link href={`/chat?agent=${agent.id}`}>Start chat</Link>
          </Button>
        )}
        <Button variant="outline" size="lg" onClick={() => setConnectOpen(true)}>
          Connection setup
        </Button>
        {view && (
          <span className="border-border text-muted-foreground flex items-center rounded-lg border px-4 font-mono text-xs">Agent Card v{view.version}</span>
        )}
        {agent.source === "managed" && (
          <Button variant="ghost" size="lg" onClick={remove} disabled={removing} className="text-muted-foreground">
            {removing ? <Loader2 className="animate-spin" /> : <Trash2 />} Remove
          </Button>
        )}
      </div>

      {view ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] items-start gap-3">
          <InfoCard label="Capabilities">
            {[
              ["Streaming", view.streaming],
              ["Push notifications", view.pushNotifications],
              ["Extended card", view.extendedCard],
            ].map(([key, on]) => (
              <div key={String(key)} className="flex justify-between py-1.5">
                <span>{String(key)}</span>
                <span className={cn(on ? "text-success" : "text-muted-foreground")}>{on ? "Yes" : "No"}</span>
              </div>
            ))}
            {view.extensions.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                <span className="label-mono">Extensions</span>
                {view.extensions.map((uri) => (
                  <span key={uri} className="text-muted-foreground font-mono text-xs break-all">
                    {uri}
                  </span>
                ))}
              </div>
            )}
          </InfoCard>

          <InfoCard label="Interfaces">
            {(view.bindings.length ? view.bindings : ["—"]).map((binding) => (
              <div key={binding} className="flex items-center gap-2 py-1.5">
                <Chip>{binding}</Chip>
                <span className="text-muted-foreground truncate font-mono text-xs">{view.url}</span>
              </div>
            ))}
            <p className="text-muted-foreground pt-1.5 font-mono text-xs">
              tenant: <span className="text-foreground">{view.tenant ?? "—"}</span>
            </p>
          </InfoCard>

          <InfoCard label="Skills">
            {view.skills.length === 0 && <p className="text-muted-foreground text-sm">No skills advertised.</p>}
            {view.skills.map((skill) => (
              <div key={skill.id} className="border-border border-t py-2 first:border-t-0">
                <div className="font-semibold">{skill.name}</div>
                <div className="text-muted-foreground text-[13px]">{skill.description}</div>
              </div>
            ))}
          </InfoCard>

          <InfoCard label="Security">
            <p className="mb-2 text-sm">Card signature: {agent.trust ?? "unknown"}</p>
            <div className="py-1.5">{view.security.length ? view.security.join(", ") : "None advertised"}</div>
            <h4 className="label-mono mt-2.5 mb-1.5">Default input modes</h4>
            <div className="flex flex-wrap gap-1.5">{view.inputModes.map((mode) => <Chip key={mode}>{mode}</Chip>)}</div>
            <h4 className="label-mono mt-2.5 mb-1.5">Default output modes</h4>
            <div className="flex flex-wrap gap-1.5">{view.outputModes.map((mode) => <Chip key={mode}>{mode}</Chip>)}</div>
          </InfoCard>
        </div>
      ) : (
        <p className="border-brand/40 bg-brand/10 text-brand rounded-lg border px-4 py-3 font-mono text-sm">{agent.error}</p>
      )}
      <ConnectAgentDialog open={connectOpen} onOpenChange={setConnectOpen} initialUrl={agent.cardUrl} />
    </div>
  );
}
