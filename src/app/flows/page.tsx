"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Workflow } from "lucide-react";
import { motion } from "motion/react";
import { useShallow } from "zustand/react/shallow";
import { Chip, EmptyState, StateChip } from "@/components/a2a/primitives";
import { groupConversations } from "@/lib/conversations";
import { referencesOf, shortTaskId, taskTitle } from "@/lib/task-view";
import { useTaskStore, type TrackedTask } from "@/store/task-store";
import { cn } from "@/lib/utils";

function TaskNode({ task, accent, refs }: { task: TrackedTask; accent?: "brand"; refs?: string[] }) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Link
        href={task.localId ? `/tasks/${task.localId}` : "/tasks"}
        className={cn(
          "bg-card hover:bg-accent/40 flex h-full flex-col gap-1 rounded-xl border p-3.5 transition-colors",
          accent === "brand" ? "border-brand" : "border-border",
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-semibold">{taskTitle(task, 40)}</span>
          <StateChip state={task.state} />
        </div>
        <span className="text-muted-foreground font-mono text-[11px]">
          {shortTaskId(task.taskId)} · {task.agentName}
        </span>
        {refs && refs.length > 0 && (
          <>
            <span className="label-mono mt-2">referenceTaskIds</span>
            <div className="flex flex-wrap gap-1.5">
              {refs.map((id) => (
                <Chip key={id}>{shortTaskId(id)}</Chip>
              ))}
            </div>
          </>
        )}
      </Link>
    </motion.div>
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

  if (!loaded) return <p role="status" className="text-muted-foreground p-6">Loading orchestration…</p>;

  if (!conversation) {
    return (
      <EmptyState icon={<Workflow className="size-7" />} title="No orchestration yet">
        Tasks that share a contextId show up here, with later tasks pointing at earlier ones through referenceTaskIds.
      </EmptyState>
    );
  }

  const real = conversation.tasks.filter((task) => task.kind !== "message");
  const ids = new Set(real.map((task) => task.taskId));
  const refsOf = (task: TrackedTask) => referencesOf(task).filter((id) => ids.has(id));
  const dependents = real.filter((task) => refsOf(task).length > 0);
  const sources = real.filter((task) => !dependents.includes(task));

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 pb-24 md:p-6">
      <h1 className="font-mono text-lg font-bold tracking-tight">Orchestration</h1>
      <p className="text-muted-foreground mt-0.5 mb-4">One context, several tasks. Later tasks point at earlier ones through referenceTaskIds.</p>

      {conversations.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Conversation">
          {conversations.map((item) => (
            <button
              key={item.key}
              role="tab"
              aria-selected={item.key === conversation.key}
              onClick={() => setPicked(item.key)}
              className={cn(
                "max-w-56 truncate rounded-full border px-2.5 py-1 font-mono text-xs font-medium transition-colors",
                item.key === conversation.key ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <Chip>contextId</Chip>
        <span className="font-mono text-sm font-medium">{conversation.tasks.find((task) => task.contextId)?.contextId ?? conversation.key}</span>
        <Link href={`/chat/${conversation.key}`} className="text-primary ml-auto font-mono text-xs hover:underline">
          Open chat →
        </Link>
      </div>

      <div className="flex flex-col items-stretch gap-3 md:flex-row">
        <div className="bg-card border-primary flex-1 rounded-xl border p-3.5">
          <h3 className="label-mono mb-1.5">Conversation agent</h3>
          <div className="font-semibold">{conversation.agentName}</div>
          <p className="text-muted-foreground text-[13px]">
            Sends SendMessage for each task in this context{dependents.length ? " and links results through referenceTaskIds." : "."}
          </p>
        </div>
        <div className="text-muted-foreground hidden items-center md:flex">
          <ArrowRight className="size-4" />
        </div>
        <div className={cn("flex flex-col gap-3", dependents.length ? "md:flex-[1.4]" : "md:flex-[2.4]")}>
          {sources.map((task) => (
            <TaskNode key={task.taskId} task={task} />
          ))}
        </div>
        {dependents.length > 0 && (
          <>
            <div className="text-muted-foreground hidden items-center md:flex">
              <ArrowRight className="size-4" />
            </div>
            <div className="flex flex-col gap-3 md:flex-[1.4]">
              {dependents.map((task) => (
                <TaskNode key={task.taskId} task={task} accent="brand" refs={refsOf(task)} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
