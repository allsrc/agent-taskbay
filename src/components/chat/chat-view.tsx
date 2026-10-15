"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { AgentAvatar } from "@/components/a2a/primitives";
import { CommandError } from "@/components/a2a/command-error";
import { AGENT_HISTORY_NOTE, AgentHistoryDivider, LoadAgentHistoryButton, splitAgentHistory } from "@/components/chat/agent-history";
import { DiscoveredMarker } from "@/components/chat/discovered-marker";
import { SteeringChip } from "@/components/chat/steering-chip";
import { RestartDialog } from "@/components/chat/restart-dialog";
import { cancelOverHttp, initialRestart, outgoingFromParts, runRestart, type RestartProgress } from "@/lib/restart-task";
import { Pill } from "@/components/patterns/status";
import { CommandFailureError, failureFromError, failureFromResponse, type CommandFailure } from "@/lib/command-failure";
import { Composer } from "@/components/chat/composer";
import { StructuredForm } from "@/components/chat/structured-form";
import { startFormFromCard } from "@/lib/structured-form";
import { A2uiSurfaces } from "@/components/a2ui/surface";
import { A2UI_EXTENSION_URI, a2uiClientMetadata, surfacesFromParts } from "@/lib/a2ui";
import { isActivityArtifact, planMessages, settleArtifacts } from "@/lib/chat-activity";
import { ActivityLog, AgentBubble, ArtifactCard, ProgressLog, SenderLabel, TaskCard, UserBubble } from "@/components/chat/timeline";
import { SideRail, useIsDesktop, type RailTab } from "@/components/chat/side-rail";
import { useStickToBottom } from "@/components/chat/use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { conversationKey, findConversation, groupConversations, isOpenTask, shouldAdoptConversationKey } from "@/lib/conversations";
import type { OutgoingPart } from "@/lib/message-parts";
import type { WireEntry } from "@/lib/wire-sequence";
import { defaultReturnImmediately } from "@/lib/agent-card";
import { runSend, userThreadMessage } from "@/lib/run-message";
import { normalizeParts } from "@/lib/content";
import type { SteeringEntry } from "@/shared/task-types";
import { isActiveState, stateName, taskTitle } from "@/lib/task-view";
import { useAgentStore } from "@/store/agent-store";
import { useSettingsStore } from "@/store/settings-store";
import { useTaskStore, type SendConfig, type ThreadMessage, type TrackedTask } from "@/store/task-store";
import type { DurableTaskView } from "@/shared/task-types";
import { cn } from "@/lib/utils";

const NEW_TASK = "new";

/** A message can be restarted while its task has not finished. */
const canRestart = (task: TrackedTask) => task.kind !== "message" && isOpenTask(task);

function RestartButton({ onClick }: { onClick: () => void }) {
  return <div className="flex justify-end"><Button variant="ghost" size="xs" onClick={onClick}>Stop and restart with this</Button></div>;
}

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
  // A new conversation sends the tenant the person chose, else the card's only or default tenant; an existing one keeps its own.
  // The effective tenant is sent and stored, so Taskbay's identity for the task matches the agent's.
  const [tenantChoice, setTenantChoice] = useState<{ agentId: string; tenant: string } | null>(null);
  const tenantOptions = agent?.connection?.tenants ?? [];
  const newConversation = tasks.length === 0;
  const chosenTenant = tenantChoice?.agentId === agentId && tenantOptions.includes(tenantChoice.tenant) ? tenantChoice.tenant : undefined;
  const sendTenant = newConversation ? chosenTenant ?? agent?.connection?.tenant ?? "" : tasks[0]?.tenant;
  // The card decides which extensions this send activates (A2UI), so wait for discovery instead of sending without it.
  const agentsStatus = useAgentStore((state) => state.status);
  const discovering = !agent?.view && agentsStatus !== "ready" && agentsStatus !== "error";
  const settings = useSettingsStore();

  const desktop = useIsDesktop();
  const [railOpen, setRailOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [railTab, setRailTab] = useState<RailTab>("sequence");
  const [returnImmediatelyOverride, setReturnImmediatelyOverride] = useState<boolean | null>(null);
  const returnImmediately = returnImmediatelyOverride ?? defaultReturnImmediately(settings.returnImmediately, Boolean(view?.streaming));
  const [historyLength, setHistoryLength] = useState(settings.historyLength);
  const [outOverride, setOutOverride] = useState<string[] | null>(null);
  const [refIds, setRefIds] = useState<string[]>([]);
  const [override, setOverride] = useState<string | null>(null);
  const [pending, setPending] = useState<ThreadMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [error, setError] = useState<CommandFailure | null>(null);
  const [renderedAt] = useState(() => Date.now());
  // What the person last tried to send, so a finished task can be replaced by a new one in the same conversation.
  const [lastSend, setLastSend] = useState<OutgoingPart[] | null>(null);
  // What happened to each message sent to a working task, by task. Read from the task's detail: list rows and snapshots do not carry it.
  const [steering, setSteering] = useState<Record<string, SteeringEntry[]>>({});
  // "Stop and restart with this instruction" in progress: which message, and how far the two steps got.
  const [restart, setRestart] = useState<{ task: TrackedTask; messageId: string; parts: OutgoingPart[]; progress: RestartProgress; attempt: number } | null>(null);
  const [wire, setWire] = useState<WireEntry[]>([]);
  const [seed, setSeed] = useState<{ id: number; text: string } | undefined>();
  const wireId = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const composerBar = useRef<HTMLDivElement>(null);

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

  // Follow new content while you are at the bottom, however it grows; scrolling up to read pauses it.
  const { follow } = useStickToBottom({ scroller, watch: [column, composerBar] });

  const refreshSteering = useCallback(async (localId: string) => {
    try {
      const response = await fetch(`/api/tasks/${localId}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { task?: { steering?: SteeringEntry[] } };
      setSteering((current) => ({ ...current, [localId]: body.task?.steering ?? [] }));
    } catch { /* The chip is a convenience; the task itself is unaffected. */ }
  }, []);
  // Read again whenever a task of this conversation changes: the agent may have answered since.
  const taskVersions = tasks.filter((task) => task.kind !== "message" && task.localId).map((task) => `${task.localId}:${(task as { version?: number }).version ?? ""}:${task.state}`).join("|");
  useEffect(() => {
    const controller = new AbortController();
    for (const entry of taskVersions ? taskVersions.split("|") : []) {
      const localId = entry.split(":")[0];
      fetch(`/api/tasks/${localId}`, { cache: "no-store", signal: controller.signal })
        .then((response) => (response.ok ? response.json() : undefined))
        .then((body: { task?: { steering?: SteeringEntry[] } } | undefined) => { if (body) setSteering((current) => ({ ...current, [localId]: body.task?.steering ?? [] })); })
        .catch(() => undefined);
    }
    return () => controller.abort();
  }, [taskVersions]);

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
      setError(null);
      const response = await fetch(`/api/agents/${task.agentId}/tasks/${encodeURIComponent(task.taskId)}/cancel?tenant=${encodeURIComponent(task.tenant ?? "")}`, { method: "POST" });
      if (!response.ok) {
        const failure = await failureFromResponse(response, "Failed to cancel the task.");
        throw new CommandFailureError(failure.message, failure);
      }
      const body = await response.json();
      const responseTask = await fetch(`/api/tasks/${task.localId}`, { cache: "no-store" });
      const committed = await responseTask.json();
      if (!responseTask.ok) throw new Error(committed.error?.message ?? "Could not refresh canceled task.");
      upsertTask(committed.task);
      pushWire("out", "CancelTask", { method: "CancelTask", params: { id: task.taskId } });
      pushWire("in", "task", body.result);
      toast.success("Task canceled");
    } catch (cause) {
      const failure = failureFromError(cause, "Failed to cancel the task.");
      setError(failure);
      // The agent said the task cannot be canceled: its real state may differ from what we show, so read it again.
      if (failure.kind === "task_not_cancelable" || failure.kind === "task_terminal") {
        const refreshed = await fetch(`/api/tasks/${task.localId}`, { cache: "no-store" }).then((reply) => reply.ok ? reply.json() : undefined).catch(() => undefined);
        if (refreshed?.task) upsertTask(refreshed.task);
      }
    } finally {
      setCancelingId(null);
    }
  }

  /**
   * Continues the chosen open task (same `taskId`), or sends within this
   * `contextId` without a `taskId`; the agent then answers with a Message or
   * opens a new Task, and both land in this conversation.
   */
  async function send(parts: OutgoingPart[], forTask?: TrackedTask, options?: { forceNew?: boolean; restartOf?: TrackedTask; messageId?: string; rethrow?: boolean }) {
    const effectiveTarget = options?.forceNew ? undefined : forTask ?? targetTask;
    setLastSend(parts);
    if (sending || !agentId || discovering) {
      if (options?.rethrow) throw new Error("Taskbay is still sending another message. Try again in a moment.");
      return;
    }
    // A restart starts a new task but keeps the old one's skill and context.
    const like = options?.restartOf ?? effectiveTarget;
    const skillId = like?.skillId ?? (view?.requiresSkill ? selectedSkill || view.skills[0]?.id : undefined);
    const contextId = options?.restartOf?.contextId ?? (view?.requiresSkill ? effectiveTarget?.contextId : tasks.find((task) => task.contextId)?.contextId);
    const config: SendConfig = {
      returnImmediately,
      acceptedOutputModes: outputModes,
      referenceTaskIds: options?.restartOf ? [options.restartOf.taskId] : refIds.length ? refIds : undefined,
      extensions: [...new Set([...settings.extensions.filter((item) => item.enabled).map((item) => item.uri), ...(a2uiOn ? [A2UI_EXTENSION_URI] : [])])],
      // An agent that advertises A2UI learns which catalog this console renders on every message (extension spec).
      ...(a2uiOn ? { metadata: a2uiClientMetadata() } : {}),
    };
    if (historyLength.trim() && Number.isInteger(Number(historyLength)) && Number(historyLength) >= 0) config.historyLength = Number(historyLength);

    setSending(true);
    setError(null);
    follow();
    const userMessage = { ...userThreadMessage(parts, { contextId, taskId: effectiveTarget?.taskId }, config), ...(options?.messageId ? { id: options.messageId } : {}) };
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
        { skillId, agentId, agentName: view?.name ?? conversation?.agentName ?? "Agent", parts, taskId: effectiveTarget?.taskId, contextId, tenant: sendTenant, config, userMessage, base },
        {
          onUpdate: (next) => {
            const nextKey = conversationKey(next);
            const adoptConversation = shouldAdoptConversationKey(key, nextKey, landed);
            landed = nextKey;
            if (next.messages.some((message) => message.id === userMessage.id)) setPending(null);
            upsertTask(next);
            if (adoptConversation) setKey(nextKey);
          },
          onRawEvent: (event) => {
            const kind = event && typeof event === "object" ? (Object.keys(event)[0] ?? "event") : "event";
            pushWire("in", kind, event);
          },
        },
      );
      setOverride(null);
      setRefIds([]);
    } catch (cause) {
      if (options?.rethrow) throw cause;
      setError(failureFromError(cause, "Failed to send the message."));
    } finally {
      setSending(false);
      setPending(null);
      if (effectiveTarget?.localId) void refreshSteering(effectiveTarget.localId);
      if (landed && landed !== key) {
        // Reflect the new conversation in the URL without remounting (keeps wire log and options).
        window.history.replaceState(null, "", `/chat/${landed}`);
      }
    }
  }

  /** The two steps of a restart. The ids derive from the message being restarted, so a second click or a reload repeats the same commands instead of creating new ones. */
  const restartSteps = (current: NonNullable<typeof restart>) => ({
    cancel: () => {
      pushWire("out", "CancelTask", { method: "CancelTask", params: { id: current.task.taskId } });
      return cancelOverHttp(current.task, `restart-cancel-${current.messageId}-${current.attempt}`);
    },
    readState: async () => {
      const reply = await fetch(`/api/tasks/${current.task.localId}`, { cache: "no-store" });
      if (!reply.ok) return undefined;
      const body = (await reply.json()) as { task?: DurableTaskView };
      if (body.task) upsertTask(body.task);
      return body.task?.state;
    },
    start: () => send(current.parts, undefined, { forceNew: true, restartOf: current.task, messageId: `restart-${current.messageId}`, rethrow: true }),
  });
  async function runRestartFrom(from: "cancel" | "start") {
    if (!restart || sending) return;
    // A cancel that failed is tried again as a new command; one that is done is never repeated.
    const current = from === "cancel" && restart.progress.cancel.status === "failed" ? { ...restart, attempt: restart.attempt + 1 } : restart;
    if (current !== restart) setRestart(current);
    const result = await runRestart(restartSteps(current), from, (progress) => setRestart((now) => (now ? { ...now, progress } : now)), current.progress);
    void refreshSteering(current.task.localId ?? "");
    if (result.start.status === "done") toast.success("New task started");
  }

  if (!agentId) return null;
  const name = view?.name ?? conversation?.agentName ?? (agent ? "Unreachable agent" : "Agent");
  const suggestion = view?.skills.find((skill) => skill.examples.length)?.examples[0] ?? view?.skills[0]?.description;
  const empty = tasks.length === 0 && !pending;
  const startForm = startFormFromCard(view?.extensions ?? [], view?.extensionParams);
  const a2uiOn = (view?.extensions ?? []).includes(A2UI_EXTENSION_URI);

  const messageColumn = "mx-auto w-full max-w-[760px]";
  // A name label goes above the first message of each run from one side, so "you" and "the agent" are easy to tell apart.
  const spoke: { last: "you" | "agent" | null } = { last: null };
  const sender = (who: "you" | "agent", key: string) => {
    if (spoke.last === who) return [];
    spoke.last = who;
    return [<SenderLabel key={`who-${key}`} who={who} name={name} id={agentId} />];
  };

  return (
    <div className="flex flex-1 md:min-h-0">
      <div className="flex min-w-0 flex-1 flex-col md:min-h-0">
        <header className="top-chrome sticky z-30 flex shrink-0 items-center gap-2.5 border-b bg-background/90 px-4 py-2.5 backdrop-blur-xl md:static md:px-6 md:py-3">
          <AgentAvatar name={name} id={agentId} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{name}</span>{tasks.some((task) => task.origin === "discovered") && <Pill tone="neutral">Discovered</Pill>}</div>
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

        <div ref={scroller} className="flex flex-1 flex-col md:min-h-0 md:overflow-auto">
          {/* Sized to its content (flex-basis auto, no shrink). With a zero basis the column is capped at the pane height, the
              messages overflow it, and the bottom padding that should separate the last message from the composer is lost. */}
          <div ref={column} className={cn(messageColumn, "flex min-h-[40dvh] flex-[1_0_auto] flex-col gap-4 p-4 pb-6 md:min-h-full md:p-6")}>
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

            {tasks.map((fullTask) => {
              // Messages that only the agent's own history carried are shown apart, under their own label.
              const { received, history } = splitAgentHistory(fullTask.messages);
              const task = history.length ? { ...fullTask, messages: received } : fullTask;
              const firstAgent = task.messages.findIndex((message) => message.role === "agent");
              const cardAt = task.kind === "message" ? -1 : firstAgent >= 0 ? firstAgent : 0;
              // In-between status updates fold into one progress log; the last message, questions and results stay prominent.
              const lastIndex = task.messages.length - 1;
              const settled = settleArtifacts(task.artifacts, task.kind !== "message" && !isActiveState(task.state));
              const activity = settled.filter(isActivityArtifact);
              const results = settled.filter((artifact) => !isActivityArtifact(artifact));
              const { activityMessages, isUpdate, repeated } = planMessages(task, results);
              const activityMessageIds = new Set(activityMessages.map((message) => message.id));
              // Each run of consecutive updates becomes its own log, so the conversation keeps its order.
              const runs = new Map<number, ThreadMessage[]>();
              task.messages.forEach((message, index) => {
                if (!isUpdate(index)) return;
                const startsRun = index === 0 || !isUpdate(index - 1);
                if (startsRun) runs.set(index, [message]);
                else for (const [start, list] of runs) if (start + list.length === index) list.push(message);
              });
              const rows = task.messages.flatMap((message, index) => [
                ...(activityMessageIds.has(message.id) || isUpdate(index) || (repeated && index === lastIndex) ? [] : [
                  ...sender(message.role === "user" ? "you" : "agent", message.id),
                  message.role === "user" ? (
                    <Fragment key={message.id}>
                      <UserBubble message={message} />
                      {(steering[task.localId ?? ""] ?? []).filter((entry) => entry.messageId === message.id).map((entry) => (
                        <Fragment key={entry.commandId}>
                          <SteeringChip entry={entry} />
                          {canRestart(task) && <RestartButton onClick={() => setRestart({ task, messageId: message.id, parts: outgoingFromParts(message.parts), progress: initialRestart(), attempt: 0 })} />}
                        </Fragment>
                      ))}
                    </Fragment>
                  ) : (
                    <AgentBubble key={message.id} message={message} taskState={task.kind === "message" ? undefined : task.state} onReply={(text) => void send([{ text, mediaType: "text/plain" }])}
                      extensions={view?.extensions} a2ui={a2uiOn} answered={sending || index !== task.messages.length - 1}
                      onSubmitForm={(submission) => send([{ data: submission, mediaType: "application/json" }])} />
                  ),
                ]),
                ...(index === cardAt ? [<TaskCard key={`card-${task.taskId}`} task={task} canceling={cancelingId === task.taskId} onCancel={() => void cancelTask(task)} />] : []),
                ...(runs.has(index) ? [...sender("agent", `log-${message.id}`), <ProgressLog key={`log-${message.id}`} messages={runs.get(index)!} active={isOpenTask(task)} agentName={name} />] : []),
              ]);
              // Messages that never reached the task (the agent refused them, or Taskbay cannot tell) are not in its history, so they are shown here.
              const unsent = (steering[task.localId ?? ""] ?? []).filter((entry) => entry.text && !task.messages.some((message) => message.id === entry.messageId));
              return (
                <div key={task.taskId} className="flex flex-col gap-3.5">
                  <LoadAgentHistoryButton task={task} onLoaded={upsertTask} />
                  {task.origin === "discovered" && <DiscoveredMarker task={task} now={renderedAt} />}
                  {history.length > 0 && <AgentHistoryDivider>What Taskbay received</AgentHistoryDivider>}
                  {rows}
                  {unsent.map((entry) => (
                    <Fragment key={entry.commandId}>
                      <UserBubble message={{ id: entry.messageId, role: "user", parts: normalizeParts([{ text: entry.text }]), timestamp: entry.sentAt }} />
                      <SteeringChip entry={entry} />
                      {canRestart(task) && <RestartButton onClick={() => setRestart({ task, messageId: entry.messageId, parts: [{ text: entry.text!, mediaType: "text/plain" }], progress: initialRestart(), attempt: 0 })} />}
                    </Fragment>
                  ))}
                  {a2uiOn && (
                    <A2uiSurfaces state={surfacesFromParts(task.messages.filter((message) => message.role === "agent").flatMap((message) => message.parts))}
                      interactive={!sending && isOpenTask(task)} onAction={(message) => send([{ data: message, mediaType: "application/a2ui+json" }], task)} />
                  )}
                  {task.kind !== "message" && task.messages.length === 0 && (
                    <TaskCard task={task} canceling={cancelingId === task.taskId} onCancel={() => void cancelTask(task)} />
                  )}
                  {(activity.length > 0 || activityMessages.length > 0) && [...sender("agent", `act-${task.taskId}`), <ActivityLog key="activity" artifacts={activity} messages={activityMessages} active={isOpenTask(task)} />]}
                  {results.flatMap((artifact) => [...sender("agent", artifact.artifactId), <ArtifactCard key={artifact.artifactId} artifact={artifact} />])}
                  {history.length > 0 && (
                    <>
                      <AgentHistoryDivider>History the agent returned</AgentHistoryDivider>
                      <p className="text-muted-foreground text-center text-xs">{AGENT_HISTORY_NOTE}</p>
                      {history.map((message) => message.role === "user" ? <UserBubble key={message.id} message={message} /> : <AgentBubble key={message.id} message={message} />)}
                    </>
                  )}
                </div>
              );
            })}
            {pending && !tasks.some((task) => task.messages.some((message) => message.id === pending.id)) && [...sender("you", pending.id), <UserBubble key={pending.id} message={pending} />]}
            {error && <CommandError failure={error}
              onStartNew={lastSend ? () => { setError(null); void send(lastSend, undefined, { forceNew: true }); } : undefined} />}
          </div>
        </div>

        <div ref={composerBar} className="sticky bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-30 shrink-0 border-t bg-background md:static">
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
              hint={waiting ? "Reply to the agent, or pick an option above…" : targetTask ? "Send more input to the running task. The agent decides whether to use it." : undefined}
              onSend={send}
            />
          </div>
        </div>
      </div>

      {restart && (
        <RestartDialog
          open
          onOpenChange={(open) => { if (!open) setRestart(null); }}
          progress={restart.progress}
          taskTitle={taskTitle(restart.task, 60)}
          onConfirm={() => void runRestartFrom("cancel")}
          onRetryStart={() => void runRestartFrom("start")}
          onSendAsInput={() => { const { parts, task } = restart; setRestart(null); void send(parts, task); }}
        />
      )}

      <SideRail
        open={railVisible}
        onOpenChange={desktop ? setRailOpen : setSheetOpen}
        tab={railTab}
        onTab={setRailTab}
        entries={wire}
        agentName={name}
        options={{
          returnImmediately,
          onReturnImmediately: setReturnImmediatelyOverride,
          historyLength,
          onHistoryLength: setHistoryLength,
          outputModes,
          declaredOutputModes: view?.outputModes ?? [],
          onOutputModes: setOutOverride,
          tasks: tasks.filter((task) => task.kind !== "message"),
          refIds,
          onRefIds: setRefIds,
          tenant: tenantOptions.length > 1
            ? { options: tenantOptions, value: (newConversation ? sendTenant : tasks[0]?.tenant) ?? "", locked: !newConversation, onChange: (tenant) => setTenantChoice({ agentId, tenant }) }
            : undefined,
        }}
      />
    </div>
  );
}
