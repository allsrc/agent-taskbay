"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { AgentAvatar } from "@/components/a2a/primitives";
import { ConnectAgentDialog } from "@/components/agents/connect-agent-dialog";
import { ListPane, ListRow, ListStatus, MasterDetail } from "@/components/console/master-detail";
import { StatusDot } from "@/components/patterns/status";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { advertisedName, useAgentStore } from "@/store/agent-store";

/** `host:port` of a card URL, so agents with the same name can be told apart in a list. */
const hostOf = (cardUrl: string) => { try { return new URL(cardUrl).host; } catch { return cardUrl; } };

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const agents = useAgentStore((state) => state.agents);
  const status = useAgentStore((state) => state.status);
  const [query, setQuery] = useState("");
  const [connectOpen, setConnectOpen] = useState(false);
  const activeId = pathname.split("/")[2];
  const needle = query.trim().toLowerCase();
  const visible = agents.filter((agent) => {
    if (!needle) return true;
    const view = agent.view;
    return [agent.nickname, view?.name, agent.cardName, view?.description, ...(view?.skills.map((skill) => skill.name) ?? []), agent.cardUrl]
      .filter(Boolean)
      .some((text) => String(text).toLowerCase().includes(needle));
  });

  return (
    <>
      <MasterDetail
        showDetail={Boolean(activeId)}
        list={
          <ListPane
            title="Agents"
            actions={<Button size="sm" onClick={() => setConnectOpen(true)}><Plus /> Add agent</Button>}
            controls={
              <InputGroup>
                <InputGroupAddon><Search /></InputGroupAddon>
                <InputGroupInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents or skills…" aria-label="Search agents" />
              </InputGroup>
            }
          >
            <ListStatus
              loading={status === "loading" && !agents.length}
              loadingLabel="Discovering agents"
              empty={status === "ready" && !agents.length}
              emptyText="No agents yet. Add one by its Agent Card URL."
            />
            {visible.map((agent) => (
              <ListRow key={agent.id} href={`/agents/${agent.id}`} active={activeId === agent.id} className="flex-row items-center gap-3">
                <AgentAvatar name={agent.view?.name ?? "Agent"} id={agent.id} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{agent.view?.name ?? agent.nickname ?? "Unreachable agent"}</div>
                  {advertisedName(agent) && <div className="truncate text-[11px] text-muted-foreground" title="Name on the agent's card">{advertisedName(agent)}</div>}
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {agent.view ? `v${agent.view.version} · ${agent.view.security[0] ?? "no auth"}` : (agent.error ?? "discovery failed")}
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground" title={agent.cardUrl}>
                    {hostOf(agent.cardUrl)}
                  </div>
                </div>
                <span title={agent.view ? "Reachable" : "Discovery failed"}><StatusDot tone={agent.view ? "success" : "danger"} live={Boolean(agent.view)} /></span>
              </ListRow>
            ))}
          </ListPane>
        }
      >
        {children}
      </MasterDetail>
      <ConnectAgentDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </>
  );
}
