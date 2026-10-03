"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { AgentAvatar } from "@/components/a2a/primitives";
import { Composer } from "@/components/chat/composer";
import { AgentBubble, ArtifactCard, TaskCard, UserBubble } from "@/components/chat/timeline";
import { SideRail, useIsDesktop, type RailTab } from "@/components/chat/side-rail";
import { Button } from "@/components/ui/button";
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
  async function send(parts: OutgoingPart[]) {
    if (sending || !agentId) return;
    const skillId = targetTask?.skillId ?? (view?.requiresSkill ? selectedSkill || view.skills[0]?.id : undefined);
    const contextId = view?.requiresSkill ? targetTask?.contextId : tasks.find((task) => task.contextId)?.contextId;
    const config: SendConfig = {
      returnImmediately,
      acceptedOutputModes: outputModes,
      referenceTaskIds: refIds.length ? refIds : undefined,
      extensions: settings.extensions.filter((item) => item.enabled).map((item) => item.uri),
    };
    if (historyLength.trim() && Number.isInteger(Number(historyLength)) && Number(historyLength) >= 0) config.historyLength = Number(historyLength);

    setSending(true);
    setError(null);
    const userMessage = userThreadMessage(parts, { contextId, taskId: targetTask?.taskId }, config);
    const base = targetTask;
    setPending(userMessage);
    pushWire("out", "SendMessage", {
      jsonrpc: "2.0",
      method: "SendMessage",
      params: {
        message: { messageId: userMessage.id, contextId, taskId: targetTask?.taskId, role: "ROLE_USER", parts, referenceTaskIds: config.referenceTaskIds },
        configuration: { acceptedOutputModes: outputModes, returnImmediately, historyLength: config.historyLength },
      },
    });

    let landed: string | undefined;
    try {
      await runSend(
        { skillId, agentId, agentName: view?.name ?? conversation?.agentName ?? "Agent", parts, taskId: targetTask?.taskId, contextId, tenant: tasks[0]?.tenant, config, userMessage, base },
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

  const messageColumn = "mx-auto w-full max-w-[760px]";

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="border-border flex shrink-0 flex-wrap items-center gap-2.5 border-b px-4 py-3 md:px-6">
          <AgentAvatar name={name} id={agentId} size="sm" />
          <div className="min-w-28 flex-1">
            <div className="truncate font-semibold">{name}</div>
            <div className="text-muted-foreground truncate font-mono text-[11px]">
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
            className={cn("font-mono", railVisible && railTab === "sequence" && "border-brand text-brand")}
          >
            {"{ } Wire"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push(`/chat?agent=${agentId}`)}>
            Reset
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          <div className={cn(messageColumn, "flex min-h-full flex-col gap-3.5 p-4 md:p-6")}>
            {empty && (
              <div className="m-auto flex max-w-[440px] flex-col items-center gap-3.5 text-center">
                <h2 className="font-mono text-xl font-bold tracking-tight">
                  Message = communication.
                  <br />
                  <span className="text-brand">Task = execution.</span>
                </h2>
                <p className="text-muted-foreground">
                  Ask {name} to do work. A message holds one or more parts: text, files (inline or by URL) and structured data. Use + to add them.
                </p>
                {suggestion && (
                  <button
                    type="button"
                    onClick={() => setSeed({ id: (seed?.id ?? 0) + 1, text: suggestion })}
                    className="border-primary text-primary hover:bg-primary/10 rounded-[10px] border px-3.5 py-2.5 text-left text-[13px] transition-colors"
                  >
                    {suggestion}
                  </button>
                )}
              </div>
            )}

            {tasks.map((task) => {
              const firstAgent = task.messages.findIndex((message) => message.role === "agent");
              const cardAt = task.kind === "message" ? -1 : firstAgent >= 0 ? firstAgent : 0;
              const rows = task.messages.flatMap((message, index) => [
                message.role === "user" ? (
                  <UserBubble key={message.id} message={message} />
                ) : (
                  <AgentBubble key={message.id} message={message} taskState={task.kind === "message" ? undefined : task.state} onReply={(text) => void send([{ text, mediaType: "text/plain" }])} />
                ),
                ...(index === cardAt ? [<TaskCard key={`card-${task.taskId}`} task={task} canceling={cancelingId === task.taskId} onCancel={() => void cancelTask(task)} />] : []),
              ]);
              return (
                <div key={task.taskId} className="flex flex-col gap-3.5">
                  {rows}
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
            {error && <p className="border-brand/40 bg-brand/10 text-brand rounded-lg border px-3.5 py-2.5 font-mono text-xs">{error}</p>}
            <div ref={bottom} />
          </div>
        </div>

        <div className="border-border shrink-0 border-t">
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
                        target === task.taskId ? "border-primary bg-primary/15 text-primary" : attention ? "border-warning/60 text-warning" : "border-border text-muted-foreground hover:text-foreground",
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
                    target === NEW_TASK ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Plus className="size-3" /> new task
                </button>
              </div>
            )}
            {view?.requiresSkill && !targetTask && <label className="mb-2 block text-sm">Skill
          <select aria-label="Selected skill" value={selectedSkill || view.skills[0]?.id || ""} onChange={(event) => setSelectedSkill(event.target.value)} className="border-border bg-background ml-2 rounded-md border px-2 py-1">
            {view.skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
          </select>
        </label>}
        <Composer
              inputModes={view?.inputModes ?? []}
              sending={sending}
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
