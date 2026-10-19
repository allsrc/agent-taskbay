"use client";

import { use, useState } from "react";
import Link from "next/link";
import { CircleStop, Download, ListChecks, Loader2, MessageSquare, Radio, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Chip, EmptyState, InfoCard, StateChip } from "@/components/a2a/primitives";
import { CancelTasksDialog } from "@/components/tasks/cancel-tasks-dialog";
import { ContextSiblings } from "@/components/tasks/context-siblings";
import { RelatedTasks } from "@/components/tasks/related-tasks";
import { DiscoveredTaskNotice } from "@/components/tasks/discovered-task-notice";
import { Page, PageMessage } from "@/components/console/page";
import { Callout } from "@/components/patterns/data-display";
import { Eyebrow, Pill, StatusDot } from "@/components/patterns/status";
import { TaskAudit } from "@/components/audit/task-audit";
import { TaskApprovals } from "@/components/approvals/task-approvals";
import { TaskNotes, TaskOwnership } from "@/components/workflow/task-ownership";
import { Button, buttonVariants } from "@/components/ui/button";
import { conversationKey } from "@/lib/conversations";
import { runResubscribe } from "@/lib/run-message";
import { isActiveState, referencesOf, STATE_TONE, stateLabel, stateName, taskTitle } from "@/lib/task-view";
import { useServerResource } from "@/lib/use-server-resource";
import type { DurableTaskView } from "@/shared/task-types";
import { useTaskStore } from "@/store/task-store";
import { Identifier, IdentifierList } from "@/components/patterns/identifier";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = use(params);
  const resource = useServerResource<{ task: DurableTaskView }>(`/api/tasks/${encodeURIComponent(taskId)}`);
  const task = resource.data?.task;
  const upsertTask = useTaskStore((state) => state.upsertTask);
  const [busy, setBusy] = useState<"subscribe" | null>(null);
  const [cancelSelection, setCancelSelection] = useState<"current" | "related" | null>(null);

  if (resource.loading) return <PageMessage>Loading task…</PageMessage>;
  if (!task) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Task not found"
        action={<Link href="/tasks" className={buttonVariants({ variant: "outline" })}>Back to tasks</Link>}
      >
        {resource.error ?? "This task is not available."}
      </EmptyState>
    );
  }

  const active = task.kind !== "message" && isActiveState(task.state);
  const references = referencesOf(task);

  async function subscribe() {
    if (!task) return;
    setBusy("subscribe");
    try {
      await runResubscribe(task, { onUpdate: () => resource.refresh() });
      toast.success("Stream ended", { description: "SubscribeToTask finished; the task is up to date." });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The agent doesn't support resubscribing.");
    } finally {
      resource.refresh();
      setBusy(null);
    }
  }

  return (
    <Page
      detail
      size="wide"
      title={taskTitle(task, 80)}
      eyebrow={<StateChip state={task.state} />}
      description={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-xs">{task.agentName}</span>
          <Identifier kind="task" value={task.taskId} head={13} />
          {task.contextId ? <Identifier kind="context" value={task.contextId} head={13} /> : <span className="text-xs">No context ID</span>}
        </span>
      }
      actions={
        <>
          <Button variant="outline" onClick={resource.refresh}><RefreshCw /> Refresh</Button>
          <Button variant="outline" onClick={subscribe} disabled={!active || busy !== null}>
            {busy === "subscribe" ? <Loader2 className="animate-spin" /> : <Radio />} Subscribe
          </Button>
          <Button variant="destructive" onClick={() => setCancelSelection("current")} disabled={!active || !task.canOperate || busy !== null}>
            <CircleStop /> Cancel task
          </Button>
          <Link href={`/chat/${conversationKey(task)}`} onClick={() => upsertTask(task)} className={buttonVariants()}><MessageSquare /> Open in chat</Link>
        </>
      }
    >
      {resource.error && <Callout tone="danger" className="mb-4">{resource.error}</Callout>}
      <DiscoveredTaskNotice task={task} />
      {cancelSelection && <CancelTasksDialog taskId={task.localId} selectRelated={cancelSelection === "related"} onClose={() => { setCancelSelection(null); resource.refresh(); }} onUpdated={(updated) => { upsertTask(updated); resource.refresh(); }} />}

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-3 2xl:items-start">
        <div className="space-y-4 2xl:col-span-2">
          <InfoCard label="History">
            <ul className="divide-y">
              {task.messages.map((message) => {
                const text = message.parts.map((part) => (part.kind === "text" ? String(part.value) : `[${part.kind} · ${part.mediaType}]`)).join(" ");
                return (
                  <li key={message.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                      <Eyebrow className={message.role === "user" ? "text-brand-text" : undefined}>{message.role === "user" ? "You" : task.agentName}{message.origin === "agent-history" ? " · from the agent's history" : ""}</Eyebrow>
                      <Identifier kind="message" value={message.id} head={8} />
                    </div>
                    <div className="line-clamp-6 text-sm break-words whitespace-pre-wrap">{text}</div>
                  </li>
                );
              })}
              {task.messages.length === 0 && <li className="text-sm text-muted-foreground">No messages recorded.</li>}
            </ul>
          </InfoCard>

          <InfoCard label="Artifacts">
            <ul className="divide-y">
              {task.artifacts.map((artifact) => (
                <li key={artifact.artifactId} className="flex flex-wrap items-center gap-2 py-2.5 first:pt-0 last:pb-0">
                  <Chip>{artifact.parts[0]?.mediaType ?? "—"}</Chip>
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium">{artifact.name ?? artifact.artifactId}</span>
                  <Identifier kind="artifact" value={artifact.artifactId} head={8} />
                  {!artifact.complete && <Pill tone="brand" dot live>Streaming</Pill>}
                  {artifact.parts.filter((part) => part.kind === "url" && typeof part.value === "string" && /^\/api\/artifacts\/[0-9a-f]{64}$/.test(part.value)).map((part) => (
                    <a key={part.id} href={String(part.value)} download={part.filename ?? "artifact"} className={buttonVariants({ variant: "outline", size: "xs" })}><Download /> Download</a>
                  ))}
                </li>
              ))}
              {task.artifacts.length === 0 && <li className="text-sm text-muted-foreground">No artifacts yet.</li>}
            </ul>
          </InfoCard>

          <ContextSiblings siblings={task.contextSiblings} contextId={task.contextId} agentId={task.agentId} />
          <RelatedTasks related={task.related} onCancelRelated={() => setCancelSelection("related")} />

          {task.kind !== "message" && <TaskAudit taskId={task.localId} />}
        </div>

        <div className="space-y-4">
          {task.kind !== "message" && <TaskOwnership taskId={task.localId} active={active} />}
          <InfoCard label="Status timeline">
            <ol className="space-y-2.5">
              {(task.transitions?.length ? task.transitions : [{ state: task.state, timestamp: task.updatedAt }]).map((item, index) => (
                <li key={`${item.state}-${index}`} className="flex items-center gap-2.5">
                  <StatusDot tone={STATE_TONE[stateName(item.state)] ?? "neutral"} />
                  <span className="flex-1 text-sm">{stateLabel(item.state)}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{time(item.timestamp)}</span>
                </li>
              ))}
            </ol>
          </InfoCard>
          {task.kind !== "message" && <TaskApprovals taskId={task.localId} canRequest={active} />}
          {task.kind !== "message" && <TaskNotes taskId={task.localId} />}
          <InfoCard label="Identifiers">
            <p className="text-muted-foreground mb-3 text-xs">
              IDs for this task. Tap the copy icon to copy a whole value. “A2A” IDs come from the protocol and match what the agent logs; “Taskbay only” IDs are Taskbay&apos;s own records.
            </p>
            <IdentifierList
              items={[
                { kind: "task", value: task.taskId },
                { kind: "context", value: task.contextId },
                { kind: "record", value: task.localId },
                { kind: "tenant", value: task.tenant },
              ]}
            />
            {task.artifacts.length > 0 && (
              <div className="mt-4 space-y-2 border-t pt-3">
                <Eyebrow>Artifacts ({task.artifacts.length})</Eyebrow>
                <IdentifierList items={task.artifacts.map((artifact) => ({ kind: "artifact" as const, value: artifact.artifactId, label: artifact.name ? `Artifact ID · ${artifact.name}` : undefined }))} />
              </div>
            )}
            {references.length > 0 && (
              <div className="mt-4 space-y-2 border-t pt-3">
                <Eyebrow>Referenced tasks ({references.length})</Eyebrow>
                <IdentifierList items={references.map((id) => ({ kind: "reference" as const, value: id, href: task.referenceLinks[id] ? `/tasks/${task.referenceLinks[id]}` : undefined }))} />
              </div>
            )}
            <p className="text-muted-foreground mt-4 border-t pt-3 text-xs">
              {task.messages.length} {task.messages.length === 1 ? "message" : "messages"}. Each message&apos;s ID is shown on it under History.
            </p>
          </InfoCard>
        </div>
      </div>
    </Page>
  );
}
