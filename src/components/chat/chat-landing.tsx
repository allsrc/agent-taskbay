"use client";

import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { AgentAvatar, EmptyState, StateChip } from "@/components/a2a/primitives";
import { ChatView } from "@/components/chat/chat-view";
import { Button } from "@/components/ui/button";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { groupConversations } from "@/lib/conversations";
import { relativeTime } from "@/lib/task-view";
import { useAgentStore } from "@/store/agent-store";
import { useTaskStore } from "@/store/task-store";

export function ChatMissing() {
  return (
    <EmptyState icon={<MessageSquare className="size-7" />} title="Conversation not found">
      It isn&apos;t in this browser&apos;s local state.{" "}
      <Link href="/chat" className="text-primary hover:underline">
        Back to chat
      </Link>
    </EmptyState>
  );
}

/** `/chat`: a new chat with `?agent=`, otherwise recent conversations and a way to start one. */
export function ChatLanding({ agentId }: { agentId?: string }) {
  const tasks = useTaskStore(useShallow((state) => Object.values(state.tasks)));
  const conversations = useMemo(() => groupConversations(tasks), [tasks]);
  const agents = useAgentStore((state) => state.agents);

  if (agentId) return <ChatView key={agentId} agentId={agentId} />;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
      <h1 className="font-mono text-lg font-bold tracking-tight">Chat</h1>
      <p className="text-muted-foreground mt-0.5 mb-5">One conversation can hold many tasks. Pick up where you left off, or start a new one.</p>

      <h2 className="label-mono mb-2">Start a chat</h2>
      <div className="mb-7 flex flex-wrap gap-2">
        {agents.filter((agent) => agent.view).map((agent) => (
          <Link key={agent.id} href={`/chat?agent=${agent.id}`} className="bg-card border-border hover:border-primary/60 flex items-center gap-2.5 rounded-xl border py-2 pr-4 pl-2.5 transition-colors">
            <AgentAvatar name={agent.view?.name ?? "Agent"} id={agent.id} size="sm" />
            <span className="font-medium">{agent.view?.name}</span>
          </Link>
        ))}
        {agents.length === 0 && (
          <Button variant="outline" asChild>
            <Link href="/agents">Add an agent first</Link>
          </Button>
        )}
      </div>

      <h2 className="label-mono mb-2">Recent conversations</h2>
      {conversations.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing yet.</p>
      ) : (
        <div className="flex max-w-2xl flex-col gap-1.5">
          {conversations.map((conversation) => {
            const real = conversation.tasks.filter((task) => task.kind !== "message");
            const latest = real.at(-1);
            return (
              <Link key={conversation.key} href={`/chat/${conversation.key}`} className="bg-card border-border hover:border-primary/60 flex flex-col gap-1 rounded-xl border px-3.5 py-2.5 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">{conversation.title}</span>
                  {latest && <StateChip state={latest.state} />}
                </div>
                <span className="text-muted-foreground font-mono text-[11px]">
                  {conversation.agentName} · {real.length} task{real.length === 1 ? "" : "s"} · {relativeTime(conversation.updatedAt)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
