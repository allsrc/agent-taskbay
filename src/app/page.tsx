"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useShallow } from "zustand/react/shallow";
import { Bell, Bot, ClipboardCheck, Inbox, ListChecks, MessageSquare, Plus, ScrollText, SearchCheck, ShieldCheck } from "lucide-react";
import { AgentAvatar, StateChip } from "@/components/a2a/primitives";
import { DecisionStatusChip, RiskChip } from "@/components/approvals/badges";
import { Page } from "@/components/console/page";
import { cardSurface } from "@/components/patterns/card-surface";
import { ListSkeleton } from "@/components/patterns/collections";
import { StatTile } from "@/components/patterns/data-display";
import { Panel } from "@/components/patterns/layout";
import { Eyebrow, Tag } from "@/components/patterns/status";
import { buttonVariants } from "@/components/ui/button";
import { groupConversations } from "@/lib/conversations";
import { inboxHref } from "@/lib/inbox-view";
import { isActiveState, relativeTime } from "@/lib/task-view";
import { useServerResource } from "@/lib/use-server-resource";
import type { DecisionStatus } from "@/shared/decision-types";
import type { InboxPageView } from "@/shared/inbox-types";
import type { InboxPage } from "@/shared/notification-types";
import { useAgentStore } from "@/store/agent-store";
import { useTaskStore } from "@/store/task-store";
import { cn } from "@/lib/utils";

const ABOUT = [
  { icon: SearchCheck, title: "Discover", text: "Connect any A2A agent by its Agent Card and see what it can do." },
  { icon: ListChecks, title: "Operate", text: "Send work, follow durable tasks, and resume where you left off." },
  { icon: ShieldCheck, title: "Decide", text: "Review the exact action an agent proposes before it is sent." },
  { icon: ScrollText, title: "Audit", text: "A permanent record of who did what, and when." },
];

const STEPS = [
  { title: "Connect an agent", text: "Add one by its Agent Card URL.", href: "/agents", cta: "Add an agent", icon: Plus },
  { title: "Give it work", text: "Start a chat and ask it to do something.", href: "/chat", cta: "Open chat", icon: MessageSquare },
  { title: "Decide what needs you", text: "Approvals and input requests collect in your inbox.", href: "/inbox", cta: "Open inbox", icon: Inbox },
];

/** The console's home: what needs you, what is running, and where to start. */
export default function HomePage() {
  const agents = useAgentStore((state) => state.agents);
  const agentsStatus = useAgentStore((state) => state.status);
  const tasks = useTaskStore(useShallow((state) => Object.values(state.tasks)));
  const tasksLoaded = useTaskStore((state) => state.loaded);
  const needs = useServerResource<InboxPageView>("/api/inbox?view=needs-input&limit=20");
  const unread = useServerResource<InboxPage>("/api/notifications?limit=1&unread=true");
  const conversations = useMemo(() => groupConversations(tasks).slice(0, 5), [tasks]);

  const reachable = agents.filter((agent) => agent.view);
  const active = tasks.filter((task) => task.kind !== "message" && isActiveState(task.state)).length;
  const waiting = needs.data?.items ?? [];
  const loadingAgents = agentsStatus === "idle" || agentsStatus === "loading";
  const noAgents = !loadingAgents && agents.length === 0;

  return (
    <Page
      size="default"
      title="Agent Taskbay"
      description="The operations console for A2A agent workflows. Connect agents, follow their tasks, decide what needs a person, and keep the record."
      actions={
        <>
          <Link href={"/agents" as Route} className={buttonVariants({ variant: "outline" })}><Plus /> Add agent</Link>
          <Link href={"/chat" as Route} className={buttonVariants()}><MessageSquare /> Start a chat</Link>
        </>
      }
    >
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href={"/agents" as Route} className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <StatTile className="h-full transition-colors hover:border-border-strong" icon={Bot} label="Agents reachable" value={loadingAgents ? "–" : `${reachable.length}`} unit={agents.length > reachable.length ? `of ${agents.length}` : undefined} />
        </Link>
        <Link href={"/inbox" as Route} className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <StatTile className="h-full transition-colors hover:border-border-strong" icon={ClipboardCheck} label="Needs you" value={needs.loading ? "–" : `${waiting.length}`} />
        </Link>
        <Link href={"/tasks" as Route} className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <StatTile className="h-full transition-colors hover:border-border-strong" icon={ListChecks} label="Active tasks" value={tasksLoaded ? `${active}` : "–"} />
        </Link>
        <Link href={"/notifications" as Route} className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <StatTile className="h-full transition-colors hover:border-border-strong" icon={Bell} label="Unread notifications" value={unread.loading ? "–" : `${unread.data?.unread ?? 0}`} />
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
        <div className="space-y-4 lg:col-span-2">
          {noAgents ? (
            <Panel title="Get started" description="Three steps from an empty console to your first decision.">
              <ol className="space-y-4">
                {STEPS.map((step, index) => (
                  <li key={step.title} className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-sunken font-mono text-[11px] text-muted-foreground">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{step.title}</div>
                      <div className="text-sm text-muted-foreground">{step.text}</div>
                    </div>
                    <Link href={step.href as Route} className={buttonVariants({ variant: index === 0 ? "default" : "outline", size: "sm" })}><step.icon /> {step.cta}</Link>
                  </li>
                ))}
              </ol>
            </Panel>
          ) : (
            <Panel
              title="Needs you"
              description="Approvals to decide and tasks waiting for your input."
              action={waiting.length > 0 ? <Link href={"/inbox" as Route} className={buttonVariants({ variant: "ghost", size: "sm" })}>Open inbox</Link> : undefined}
              bodyClassName="p-0 sm:p-0"
            >
              {needs.loading ? (
                <div className="p-4" role="status" aria-label="Loading"><ListSkeleton rows={3} /></div>
              ) : waiting.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-5">You are all caught up. Nothing is waiting for you.</p>
              ) : (
                <ul className="divide-y">
                  {waiting.slice(0, 5).map((item) => (
                    <li key={`${item.kind}:${item.id}`}>
                      <Link href={inboxHref(item) as Route} className="flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted sm:px-5">
                        <span className="flex items-start gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
                          {item.kind === "approval" ? <DecisionStatusChip status={item.status as DecisionStatus} /> : <StateChip state={item.status} />}
                        </span>
                        <span className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                          <Tag>{item.kind === "approval" ? "Approval" : "Task"}</Tag>
                          {item.risk && <RiskChip risk={item.risk} />}
                          <span>{item.agentName} · {relativeTime(item.updatedAt)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          <Panel
            title="Recent conversations"
            action={conversations.length > 0 ? <Link href={"/chat" as Route} className={buttonVariants({ variant: "ghost", size: "sm" })}>All chats</Link> : undefined}
            bodyClassName="p-0 sm:p-0"
          >
            {!tasksLoaded ? (
              <div className="p-4" role="status" aria-label="Loading"><ListSkeleton rows={3} /></div>
            ) : conversations.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-5">No conversations yet. Start a chat with a connected agent.</p>
            ) : (
              <ul className="divide-y">
                {conversations.map((conversation) => {
                  const real = conversation.tasks.filter((task) => task.kind !== "message");
                  const latest = real.at(-1);
                  return (
                    <li key={conversation.key}>
                      <Link href={`/chat/${conversation.key}` as Route} className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted sm:px-5">
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
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel
            title="Connected agents"
            action={<Link href={"/agents" as Route} className={buttonVariants({ variant: "ghost", size: "sm" })}>Manage</Link>}
            bodyClassName="p-0 sm:p-0"
          >
            {loadingAgents ? (
              <div className="p-4" role="status" aria-label="Loading"><ListSkeleton rows={2} /></div>
            ) : agents.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">No agents connected yet.</p>
            ) : (
              <ul className="divide-y">
                {agents.slice(0, 6).map((agent) => (
                  <li key={agent.id}>
                    <Link href={`/chat?agent=${agent.id}` as Route} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted">
                      <AgentAvatar name={agent.view?.name ?? "Agent"} id={agent.id} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{agent.view?.name ?? "Unreachable agent"}</span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">{agent.view ? `v${agent.view.version}` : (agent.error ?? "discovery failed")}</span>
                      </span>
                      <span className={cn("size-2 shrink-0 rounded-full", agent.view ? "bg-signal" : "bg-danger")} aria-label={agent.view ? "Reachable" : "Discovery failed"} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <section className={cn(cardSurface, "p-4 hover:shadow-none")} aria-label="About Agent Taskbay">
            <Eyebrow>What it does</Eyebrow>
            <ul className="mt-3 space-y-3">
              {ABOUT.map((item) => (
                <li key={item.title} className="flex items-start gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border bg-sunken text-muted-foreground"><item.icon className="size-3.5" /></span>
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{item.title}</span>
                    <span className="text-muted-foreground"> · {item.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </Page>
  );
}
