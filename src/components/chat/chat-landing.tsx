"use client";

import Link from "next/link";
import { Bot, MessageSquare, Plus } from "lucide-react";
import { AgentAvatar, EmptyState, StateChip } from "@/components/a2a/primitives";
import { ChatView } from "@/components/chat/chat-view";
import { Page } from "@/components/console/page";
import { cardSurface } from "@/components/patterns/card-surface";
import { ListSkeleton } from "@/components/patterns/collections";
import { Eyebrow } from "@/components/patterns/status";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { groupConversations } from "@/lib/conversations";
import { relativeTime } from "@/lib/task-view";
import { useAgentStore } from "@/store/agent-store";
import { useTaskStore } from "@/store/task-store";

export function ChatMissing() {
  return (
    <EmptyState
      icon={MessageSquare}
      title="Conversation not found"
      action={<Link href="/chat" className={buttonVariants({ variant: "outline" })}>Back to chat</Link>}
    >
      This conversation is unavailable in the current organization.
    </EmptyState>
  );
}

/** `/chat`: a new chat with `?agent=`, otherwise recent conversations and a way to start one. */
export function ChatLanding({ agentId }: { agentId?: string }) {
  const tasks = useTaskStore(useShallow((state) => Object.values(state.tasks)));
  const conversations = useMemo(() => groupConversations(tasks), [tasks]);
  const loaded = useTaskStore((state) => state.loaded);
  const agents = useAgentStore((state) => state.agents);

  if (agentId) return <ChatView key={agentId} agentId={agentId} />;
  const reachable = agents.filter((agent) => agent.view);

  return (
    <Page
      title="Chat"
      size="default"
      description="One conversation can hold many tasks. Pick up where you left off, or start a new one."
    >
      <section className="mb-8 space-y-3">
        <div><Eyebrow>Start a chat</Eyebrow></div>
        {reachable.length === 0 ? (
          <div className="flex flex-col gap-4 rounded-xl border border-dashed bg-sunken/50 p-4 sm:flex-row sm:items-center sm:p-5">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card text-muted-foreground"><Bot className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">No agents are reachable yet</p>
                <p className="text-sm text-muted-foreground">Add an agent by its Agent Card URL, then come back to start a chat.</p>
              </div>
            </div>
            <Link href="/agents" className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}><Plus /> Add an agent</Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {reachable.map((agent) => (
              <Link key={agent.id} href={`/chat?agent=${agent.id}`} className={cn(cardSurface, "flex-row items-center gap-3 p-3")}>
                <AgentAvatar name={agent.view?.name ?? "Agent"} id={agent.id} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{agent.view?.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{agent.view?.skills.length ?? 0} skills</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div><Eyebrow>Recent conversations</Eyebrow></div>
        {!loaded ? <div role="status" aria-label="Loading conversations"><ListSkeleton rows={3} /></div> : conversations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet. Pick an agent above to start.</p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {conversations.map((conversation) => {
              const real = conversation.tasks.filter((task) => task.kind !== "message");
              const latest = real.at(-1);
              return (
                <li key={conversation.key}>
                  <Link href={`/chat/${conversation.key}`} className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted">
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{conversation.title}</span>
                      {latest && <StateChip state={latest.state} />}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {conversation.agentName} · {real.length} task{real.length === 1 ? "" : "s"} · {relativeTime(conversation.updatedAt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Page>
  );
}
