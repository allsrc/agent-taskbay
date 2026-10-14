"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { AgentAvatar } from "@/components/a2a/primitives";
import { Composer } from "@/components/chat/composer";
import { StructuredForm } from "@/components/chat/structured-form";
import { startFormFromCard } from "@/lib/structured-form";
import { A2uiSurfaces } from "@/components/a2ui/surface";
import { A2UI_EXTENSION_URI, a2uiClientMetadata, surfacesFromParts } from "@/lib/a2ui";
import { AgentBubble, ArtifactCard, ProgressLog, TaskCard, UserBubble } from "@/components/chat/timeline";
import { SideRail, useIsDesktop, type RailTab } from "@/components/chat/side-rail";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { conversationKey, findConversation, groupConversations, isOpenTask } from "@/lib/conversations";
import type { OutgoingPart } from "@/lib/message-parts";
import type { WireEntry } from "@/lib/wire-sequence";
import { runSend, userThreadMessage } from "@/lib/run-message";
import { stateName } from "@/lib/task-view";
import { useAgentStore } from "@/store/agent-store";
import { useSettingsStore } from "@/store/settings-store";
import { useTaskStore, type SendConfig, type ThreadMessage, type TrackedTask } from "@/store/task-store";
import { cn } from "@/lib/utils";

const NEW_TASK = "new";

export function ChatView({ conversationKey: initialKey, agentId: initialAgentId }: { conversationKey?: string; agentId?: string }) {
  const router = useRouter();
  const [selectedSkill, setSelectedSkill] = useState("");
  const [key, setKey] = useState(initialKey);
  const allTasks = useTaskStore(useShallow((state) => Object.values(state.tasks)));
  const upsertTask = useTaskStore((state) => state.upsertTask);
  const conversation = useMemo(() => (key ? findConversation(groupConversations(allTasks), key) : undefined), [allTasks, key]);
  const tasks = useMemo(() => conversation?.tasks ?? [], [conversation]);
  const agentId = conversation?.agentId ?? initialAgentId ?? "";
  const agent = useAgentStore((state) => state.agents.find((item) => item.id === agentId));
  const view = agent?.view;
  // The card decides which extensions this send activates (A2UI), so wait for discovery instead of sending without it.
  const agentsStatus = useAgentStore((state) => state.status);
  const discovering = !agent?.view && agentsStatus !== "ready" && agentsStatus !== "error";
  const settings = useSettingsStore();

  const desktop = useIsDesktop();
  const [railOpen, setRailOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [railTab, setRailTab] = useState<RailTab>("sequence");
  const [returnImmediately, setReturnImmediately] = useState(settings.returnImmediately);
  const [historyLength, setHistoryLength] = useState(settings.historyLength);
  const [outOverride, setOutOverride] = useState<string[] | null>(null);
  const [refIds, setRefIds] = useState<string[]>([]);
  const [override, setOverride] = useState<string | null>(null);
  const [pending, setPending] = useState<ThreadMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wire, setWire] = useState<WireEntry[]>([]);
  const [seed, setSeed] = useState<{ id: number; text: string } | undefined>();
  const wireId = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);

  const outputModes = outOverride ?? (view?.outputModes.length ? view.outputModes : settings.acceptedOutputModes);
  const openTasks = tasks.filter(isOpenTask);
  const defaultTarget =
    [...openTasks].reverse().find((task) => ["INPUT_REQUIRED", "AUTH_REQUIRED"].includes(stateName(task.state)))?.taskId ??
    openTasks.at(-1)?.taskId ??
    NEW_TASK;
  const target = override && (override === NEW_TASK || openTasks.some((task) => task.taskId === override)) ? override : defaultTarget;
  const targetTask = openTasks.find((task) => task.taskId === target);
  const waiting = targetTask && ["INPUT_REQUIRED", "AUTH_REQUIRED"].includes(stateName(targetTask.state));

  const liveTask = [...tasks].reverse().find((task) => task.kind !== "message");
  const stateLabel = liveTask ? stateName(liveTask.state) : tasks.length ? "MESSAGE" : "idle";

  const activity = tasks.reduce((sum, task) => sum + task.messages.length + task.artifacts.length + (task.transitions?.length ?? 0), 0);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activity, pending]);

  const pushWire = (dir: WireEntry["dir"], kind: string, json: unknown) =>
    setWire((entries) => [...entries.slice(-199), { id: wireId.current++, at: Date.now(), dir, kind, json }]);

  /** Opens the side rail (or the sheet on small screens) on `tab`; a second press on the open tab closes it. */
  const showRail = (tab: RailTab) => {
    if (desktop) {
      setRailOpen(railOpen && railTab === tab ? false : true);
      setRailTab(tab);
    } else {
      setRailTab(tab);
      setSheetOpen(true);
    }
  };
  const railVisible = desktop ? railOpen : sheetOpen;

  async function cancelTask(task: TrackedTask) {
    if (cancelingId || !window.confirm("Cancel this task?")) return;
    setCancelingId(task.taskId);
    try {
      const response = await fetch(`/api/agents/${task.agentId}/tasks/${encodeURIComponent(task.taskId)}/cancel?tenant=${encodeURIComponent(task.tenant ?? "")}`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Failed to cancel the task.");
      const responseTask = await fetch(`/api/tasks/${task.localId}`, { cache: "no-store" });
      const committed = await responseTask.json();
      if (!responseTask.ok) throw new Error(committed.error?.message ?? "Could not refresh canceled task.");
      upsertTask(committed.task);
      pushWire("out", "CancelTask", { method: "CancelTask", params: { id: task.taskId } });
      pushWire("in", "task", body.result);
      toast.success("Task canceled");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to cancel the task.");
    } finally {
      setCancelingId(null);
    }
  }

  /**
   * Continues the chosen open task (same `taskId`), or sends within this
   * `contextId` without a `taskId`; the agent then answers with a Message or
   * opens a new Task, and both land in this conversation.
   */
  async function send(parts: OutgoingPart[], forTask?: TrackedTask) {
    const effectiveTarget = forTask ?? targetTask;
    if (sending || !agentId || discovering) return;
    const skillId = effectiveTarget?.skillId ?? (view?.requiresSkill ? selectedSkill || view.skills[0]?.id : undefined);
    const contextId = view?.requiresSkill ? effectiveTarget?.contextId : tasks.find((task) => task.contextId)?.contextId;
    const config: SendConfig = {
      returnImmediately,
      acceptedOutputModes: outputModes,
      referenceTaskIds: refIds.length ? refIds : undefined,
      extensions: [...new Set([...settings.extensions.filter((item) => item.enabled).map((item) => item.uri), ...(a2uiOn ? [A2UI_EXTENSION_URI] : [])])],
      // An agent that advertises A2UI learns which catalog this console renders on every message (extension spec).
      ...(a2uiOn ? { metadata: a2uiClientMetadata() } : {}),
    };
    if (historyLength.trim() && Number.isInteger(Number(historyLength)) && Number(historyLength) >= 0) config.historyLength = Number(historyLength);

    setSending(true);
    setError(null);
    const userMessage = userThreadMessage(parts, { contextId, taskId: effectiveTarget?.taskId }, config);
    const base = effectiveTarget;
    setPending(userMessage);
    pushWire("out", "SendMessage", {
      jsonrpc: "2.0",
      method: "SendMessage",
      params: {
        message: { messageId: userMessage.id, contextId, taskId: effectiveTarget?.taskId, role: "ROLE_USER", parts, referenceTaskIds: config.referenceTaskIds },
        configuration: { acceptedOutputModes: outputModes, returnImmediately, historyLength: config.historyLength },
      },
    });

    let landed: string | undefined;
    try {
      await runSend(
        { skillId, agentId, agentName: view?.name ?? conversation?.agentName ?? "Agent", parts, taskId: effectiveTarget?.taskId, contextId, tenant: tasks[0]?.tenant, config, userMessage, base },
        {
          onUpdate: (next) => {
            landed = conversationKey(next);
            if (next.messages.some((message) => message.id === userMessage.id)) setPending(null);
            upsertTask(next);
          },
          onError: setError,
          onRawEvent: (event) => {
            const kind = event && typeof event === "object" ? (Object.keys(event)[0] ?? "event") : "event";
            pushWire("in", kind, event);
          },
        },
      );
      setOverride(null);
      setRefIds([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to send the message.");
    } finally {
      setSending(false);
      setPending(null);
      if (landed && landed !== key) {
        setKey(landed);
        // Reflect the new conversation in the URL without remounting (keeps wire log and options).
        window.history.replaceState(null, "", `/chat/${landed}`);
      }
    }
  }

  if (!agentId) return null;
  const name = view?.name ?? conversation?.agentName ?? (agent ? "Unreachable agent" : "Agent");
  const suggestion = view?.skills.find((skill) => skill.examples.length)?.examples[0] ?? view?.skills[0]?.description;
  const empty = tasks.length === 0 && !pending;
  const startForm = startFormFromCard(view?.extensions ?? [], view?.extensionParams);
  const a2uiOn = (view?.extensions ?? []).includes(A2UI_EXTENSION_URI);

  const messageColumn = "mx-auto w-full max-w-[760px]";

  return (
    <div className="flex flex-1 md:min-h-0">
      <div className="flex min-w-0 flex-1 flex-col md:min-h-0">
        <header className="top-chrome sticky z-30 flex shrink-0 items-center gap-2.5 border-b bg-background/90 px-4 py-2.5 backdrop-blur-xl md:static md:px-6 md:py-3">
          <AgentAvatar name={name} id={agentId} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{name}</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              {(tasks.find((task) => task.contextId)?.contextId ?? "new conversation").slice(0, 18)} · {stateLabel}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => showRail("options")} aria-pressed={railVisible && railTab === "options"}>
            Options
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => showRail("sequence")}
            aria-pressed={railVisible && railTab === "sequence"}
            className={cn("font-mono", railVisible && railTab === "sequence" && "border-brand/50 bg-brand-soft text-brand-text")}
          >
            {"{ } Wire"}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => router.push(`/chat?agent=${agentId}`)} aria-label="Reset conversation" title="Reset conversation">
            <RotateCcw />
          </Button>
        </header>

        <div className="flex flex-1 flex-col md:min-h-0 md:overflow-auto">
          <div className={cn(messageColumn, "flex min-h-[40dvh] flex-1 flex-col gap-4 p-4 md:min-h-full md:p-6")}>
            {empty && (
              <div className="m-auto flex max-w-[440px] flex-col items-center gap-3.5 text-center">
                <h2 className="font-heading text-2xl font-semibold tracking-tight">
                  Message = communication.
                  <br />
                  <span className="text-brand-text">Task = execution.</span>
                </h2>
                <p className="text-muted-foreground">
                  Ask {name} to do work. A message holds one or more parts: text, files (inline or by URL) and structured data. Use + to add them.
                </p>
                {suggestion && (
                  <button
                    type="button"
                    onClick={() => setSeed({ id: (seed?.id ?? 0) + 1, text: suggestion })}
                    className="border-brand text-brand-text hover:bg-brand-soft rounded-lg border px-3.5 py-2.5 text-left text-[13px] transition-colors"
                  >
                    {suggestion}
                  </button>
                )}
              </div>
            )}

            {tasks.map((task) => {
              const firstAgent = task.messages.findIndex((message) => message.role === "agent");
              const cardAt = task.kind === "message" ? -1 : firstAgent >= 0 ? firstAgent : 0;
              // In-between status updates fold into one progress log; the last message, questions and results stay prominent.
              const lastIndex = task.messages.length - 1;
              const isUpdate = (message: ThreadMessage, index: number) => task.kind !== "message" && message.role === "agent" && Boolean(message.fromStatus) && index !== lastIndex;
              // Each run of consecutive updates becomes its own log, so the conversation keeps its order.
              const runs = new Map<number, ThreadMessage[]>();
              task.messages.forEach((message, index) => {
                if (!isUpdate(message, index)) return;
                const startsRun = index === 0 || !isUpdate(task.messages[index - 1], index - 1);
                if (startsRun) runs.set(index, [message]);
                else for (const [start, list] of runs) if (start + list.length === index) list.push(message);
              });
              const rows = task.messages.flatMap((message, index) => [
                ...(isUpdate(message, index) ? [] : [
                  message.role === "user" ? (
                    <UserBubble key={message.id} message={message} />
                  ) : (
                    <AgentBubble key={message.id} message={message} taskState={task.kind === "message" ? undefined : task.state} onReply={(text) => void send([{ text, mediaType: "text/plain" }])}
                      extensions={view?.extensions} a2ui={a2uiOn} answered={sending || index !== task.messages.length - 1}
                      onSubmitForm={(submission) => send([{ data: submission, mediaType: "application/json" }])} />
                  ),
                ]),
                ...(index === cardAt ? [<TaskCard key={`card-${task.taskId}`} task={task} canceling={cancelingId === task.taskId} onCancel={() => void cancelTask(task)} />] : []),
                ...(runs.has(index) ? [<ProgressLog key={`log-${message.id}`} messages={runs.get(index)!} active={isOpenTask(task)} />] : []),
              ]);
              return (
                <div key={task.taskId} className="flex flex-col gap-3.5">
                  {rows}
                  {a2uiOn && (
                    <A2uiSurfaces state={surfacesFromParts(task.messages.filter((message) => message.role === "agent").flatMap((message) => message.parts))}
                      interactive={!sending && isOpenTask(task)} onAction={(message) => send([{ data: message, mediaType: "application/a2ui+json" }], task)} />
                  )}
                  {task.kind !== "message" && task.messages.length === 0 && (
                    <TaskCard task={task} canceling={cancelingId === task.taskId} onCancel={() => void cancelTask(task)} />
                  )}
                  {task.artifacts.map((artifact) => (
                    <ArtifactCard key={artifact.artifactId} artifact={artifact} />
                  ))}
                </div>
              );
            })}
            {pending && !tasks.some((task) => task.messages.some((message) => message.id === pending.id)) && <UserBubble message={pending} />}
            {error && <p className="border-danger/40 bg-danger/10 text-danger rounded-lg border px-3.5 py-2.5 font-mono text-xs">{error}</p>}
            <div ref={bottom} />
          </div>
        </div>

        <div className="sticky bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-30 shrink-0 border-t bg-background md:static">
          <div className={messageColumn}>
            {openTasks.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2.5 md:px-6" role="radiogroup" aria-label="Send to">
                <span className="label-mono mr-0.5">Send to</span>
                {openTasks.map((task) => {
                  const attention = ["INPUT_REQUIRED", "AUTH_REQUIRED"].includes(stateName(task.state));
                  return (
                    <button
                      key={task.taskId}
                      type="button"
                      role="radio"
                      aria-checked={target === task.taskId}
                      onClick={() => setOverride(task.taskId)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium transition-colors",
                        target === task.taskId ? "border-brand bg-brand-soft text-brand-text" : attention ? "border-warning/60 text-warning" : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {task.taskId.slice(0, 8)} · {stateName(task.state).toLowerCase().replaceAll("_", " ")}
                    </button>
                  );
                })}
                <button
                  type="button"
                  role="radio"
                  aria-checked={target === NEW_TASK}
                  onClick={() => setOverride(NEW_TASK)}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium transition-colors",
                    target === NEW_TASK ? "border-brand bg-brand-soft text-brand-text" : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Plus className="size-3" /> new task
                </button>
              </div>
            )}
            {view?.requiresSkill && !targetTask && <label className="mx-4 mt-2.5 flex items-center gap-2 text-sm md:mx-6">Skill
          <NativeSelect aria-label="Selected skill" value={selectedSkill || view.skills[0]?.id || ""} onChange={(event) => setSelectedSkill(event.target.value)}>
            {view.skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
          </NativeSelect>
        </label>}
        {startForm && target === NEW_TASK && (
          <details open={empty} className="mx-4 mt-2.5 rounded-xl border bg-card px-3 py-2 md:mx-6" data-testid="start-form">
            <summary className="cursor-pointer text-sm font-medium">Start with a form: {startForm.title}</summary>
            <div className="pt-3 pb-1">
              <StructuredForm form={startForm} disabled={sending} onSubmit={(submission) => send([{ data: submission, mediaType: "application/json" }])} />
            </div>
          </details>
        )}
        <Composer
              inputModes={view?.inputModes ?? []}
              sending={sending}
              disabled={discovering}
              seed={seed}
              hint={waiting ? "Reply to the agent, or pick an option above…" : targetTask ? "Send a follow-up to the running task…" : undefined}
              onSend={send}
            />
          </div>
        </div>
      </div>

      <SideRail
        open={railVisible}
        onOpenChange={desktop ? setRailOpen : setSheetOpen}
        tab={railTab}
        onTab={setRailTab}
        entries={wire}
        agentName={name}
        options={{
          returnImmediately,
          onReturnImmediately: setReturnImmediately,
          historyLength,
          onHistoryLength: setHistoryLength,
          outputModes,
          declaredOutputModes: view?.outputModes ?? [],
          onOutputModes: setOutOverride,
          tasks: tasks.filter((task) => task.kind !== "message"),
          refIds,
          onRefIds: setRefIds,
        }}
      />
    </div>
  );
}
