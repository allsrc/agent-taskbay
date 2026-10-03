"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { AgentAvatar, SplitPane } from "@/components/a2a/primitives";
import { ConnectAgentDialog } from "@/components/agents/connect-agent-dialog";
import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/store/agent-store";
import { cn } from "@/lib/utils";

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
    return [view?.name, view?.description, ...(view?.skills.map((skill) => skill.name) ?? []), agent.cardUrl]
      .filter(Boolean)
      .some((text) => String(text).toLowerCase().includes(needle));
  });

  return (
    <>
      <SplitPane
        showDetail={Boolean(activeId)}
        list={
          <>
            <div className="flex items-center gap-2 px-4 pt-4 pb-2.5">
              <h1 className="flex-1 font-mono text-lg font-bold tracking-tight">Agents</h1>
              <Button size="sm" onClick={() => setConnectOpen(true)}>
                <Plus /> Add agent
              </Button>
            </div>
            <div className="border-border focus-within:border-primary mx-4 mb-2.5 flex items-center gap-2 rounded-lg border px-3 py-2">
              <Search className="text-muted-foreground size-3.5" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search agents or skills…"
                aria-label="Search agents"
                className="placeholder:text-muted-foreground w-full bg-transparent font-mono text-[13px] outline-none"
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto px-2 pb-3">
              {status === "loading" && !agents.length && <p className="text-muted-foreground px-3 py-2 font-mono text-xs">Discovering agents…</p>}
              {status === "ready" && !agents.length && (
                <p className="text-muted-foreground px-3 py-2 text-sm">No agents yet. Add one by its Agent Card URL.</p>
              )}
              <AnimatePresence initial={false}>
                {visible.map((agent) => (
                  <motion.div key={agent.id} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                    <Link
                      href={`/agents/${agent.id}`}
                      className={cn(
                        "flex items-center gap-3 rounded-[10px] px-3 py-2.5 transition-colors",
                        activeId === agent.id ? "bg-accent" : "hover:bg-accent/50",
                      )}
                    >
                      <AgentAvatar name={agent.view?.name ?? "Agent"} id={agent.id} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{agent.view?.name ?? "Unreachable agent"}</div>
                        <div className="text-muted-foreground truncate font-mono text-xs">
                          {agent.view ? `v${agent.view.version} · ${agent.view.security[0] ?? "no auth"}` : (agent.error ?? "discovery failed")}
                        </div>
                      </div>
                      <span className={cn("size-2 shrink-0 rounded-full", agent.view ? "bg-success" : "bg-brand")} title={agent.view ? "Reachable" : "Discovery failed"} />
                    </Link>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </>
        }
      >
        {children}
      </SplitPane>
      <ConnectAgentDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </>
  );
}
