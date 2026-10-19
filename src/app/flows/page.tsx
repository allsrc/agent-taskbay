"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, MessageSquare, Workflow } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Chip, EmptyState, StateChip } from "@/components/a2a/primitives";
import { Page, PageMessage } from "@/components/console/page";
import { cardSurface } from "@/components/patterns/card-surface";
import { FilterChips } from "@/components/patterns/filter-chips";
import { Panel } from "@/components/patterns/layout";
import { Eyebrow } from "@/components/patterns/status";
import { buttonVariants } from "@/components/ui/button";
import { groupConversations } from "@/lib/conversations";
import { referencesOf, taskTitle } from "@/lib/task-view";
import { useTaskStore, type TrackedTask } from "@/store/task-store";
import { cn } from "@/lib/utils";

function TaskNode({ task, accent, refs }: { task: TrackedTask; accent?: "brand"; refs?: string[] }) {
  return (
    <Link
      href={(task.localId ? `/tasks/${task.localId}` : "/tasks") as Route}
      className={cn(cardSurface, "flex h-full flex-col gap-1.5 p-4", accent === "brand" && "border-brand/50")}
    >
      <div className="flex flex-wrap items-start gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{taskTitle(task, 40)}</span>
        <StateChip state={task.state} />
      </div>
      <span className="font-mono text-[11px] text-muted-foreground">Task {task.taskId.slice(0, 8)} · {task.agentName}</span>
      {refs && refs.length > 0 && (
        <div className="mt-2 space-y-1.5">
          <Eyebrow>Builds on <span className="font-mono normal-case">referenceTaskIds</span></Eyebrow>
          <div className="flex flex-wrap gap-1.5">{refs.map((id) => <Chip key={id}>Task {id.slice(0, 8)}</Chip>)}</div>
        </div>
      )}
    </Link>
  );
}

export default function FlowsPage() {
  const tasks = useTaskStore(useShallow((state) => Object.values(state.tasks)));
  const conversations = useMemo(
    () => groupConversations(tasks).filter((conversation) => conversation.tasks.some((task) => task.kind !== "message")),
    [tasks],
  );
  const loaded = useTaskStore((state) => state.loaded);
  const [picked, setPicked] = useState<string | null>(null);
  const conversation = conversations.find((item) => item.key === picked) ?? [...conversations].sort((a, b) => b.tasks.length - a.tasks.length)[0];

  if (!loaded) return <PageMessage>Loading orchestration…</PageMessage>;

  if (!conversation) {
    return (
      <EmptyState icon={Workflow} title="No orchestration yet">
        Tasks that share a contextId show up here, with later tasks pointing at earlier ones through referenceTaskIds.
      </EmptyState>
    );
  }

  const real = conversation.tasks.filter((task) => task.kind !== "message");
  const ids = new Set(real.map((task) => task.taskId));
  const refsOf = (task: TrackedTask) => referencesOf(task).filter((id) => ids.has(id));
  const dependents = real.filter((task) => refsOf(task).length > 0);
  const sources = real.filter((task) => !dependents.includes(task));
  const arrow = <div className="hidden items-center text-muted-foreground lg:flex"><ArrowRight className="size-4" /></div>;

  return (
    <Page
      title="Orchestration"
      size="wide"
      description="One context, several tasks. Later tasks point at earlier ones through referenceTaskIds."
      actions={<Link href={`/chat/${conversation.key}` as Route} className={buttonVariants({ variant: "outline" })}><MessageSquare /> Open chat</Link>}
      headerChildren={
        conversations.length > 1 ? (
          <FilterChips
            label="Conversation"
            className="pt-1"
            options={conversations.map((item) => ({ value: item.key, label: item.title }))}
            value={[conversation.key]}
            onValueChange={(next) => next[0] && setPicked(next[0])}
          />
        ) : undefined
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <Chip>contextId</Chip>
        <span className="font-mono text-sm break-all">{conversation.tasks.find((task) => task.contextId)?.contextId ?? conversation.key}</span>
      </div>

      <div className="flex flex-col items-stretch gap-4 lg:flex-row">
        <Panel title="Conversation agent" className="border-brand/50 lg:flex-1" bodyClassName="space-y-1">
          <div className="text-sm font-medium">{conversation.agentName}</div>
          <p className="text-sm text-muted-foreground">
            Sends SendMessage for each task in this context{dependents.length ? " and links results through referenceTaskIds." : "."}
          </p>
        </Panel>
        {arrow}
        <div className={cn("flex flex-col gap-4", dependents.length ? "lg:flex-[1.4]" : "lg:flex-[2.4]")}>
          {sources.map((task) => <TaskNode key={task.taskId} task={task} />)}
        </div>
        {dependents.length > 0 && (
          <>
            {arrow}
            <div className="flex flex-col gap-4 lg:flex-[1.4]">
              {dependents.map((task) => <TaskNode key={task.taskId} task={task} accent="brand" refs={refsOf(task)} />)}
            </div>
          </>
        )}
      </div>
    </Page>
  );
}
