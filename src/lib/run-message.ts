"use client";

import { sendAndStream } from "@/lib/client-stream";
import { assembleTasks } from "@/lib/content";
import type { OutgoingPart } from "@/lib/message-parts";
import { applyEvents } from "@/lib/track-events";
import { MESSAGE_ONLY_STATE, type SendConfig, type ThreadMessage, type TrackedTask, useTaskStore } from "@/store/task-store";

export { userThreadMessage } from "@/lib/track-events";

export interface RunSendInput {
  agentId: string;
  agentName: string;
  parts: OutgoingPart[];
  /** Set to continue an open task; omit to start a new task (optionally inside `contextId`). */
  taskId?: string;
  contextId?: string;
  config?: SendConfig;
  userMessage: ThreadMessage;
  /** Existing tracked task being continued; new sends start from an empty shell. */
  base?: TrackedTask;
}

/** Sends one message and reports each incremental tracked-task snapshot. Resolves with the last one. */
export async function runSend(
  input: RunSendInput,
  handlers: { onUpdate: (task: TrackedTask) => void; onError?: (message: string) => void },
  signal?: AbortSignal,
): Promise<TrackedTask | undefined> {
  const localReplyId = input.base?.kind === "message" ? input.base.taskId : `reply-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const freshShell: TrackedTask = {
    taskId: "",
    agentId: input.agentId,
    agentName: input.agentName,
    contextId: input.contextId,
    kind: "message",
    state: MESSAGE_ONLY_STATE,
    createdAt: now,
    updatedAt: now,
    messages: [input.userMessage],
    artifacts: [],
  };
  const shell: TrackedTask = input.base ? { ...input.base, messages: [...input.base.messages] } : freshShell;
  const events: unknown[] = [];
  let latest: TrackedTask | undefined;
  await sendAndStream(
    input.agentId,
    { parts: input.parts, taskId: input.taskId, contextId: input.contextId, config: input.config },
    {
      onEvent: (event) => {
        events.push(event);
        // A direct-reply thread that spawns a real Task splits off into its own tracked task.
        const splitsToTask = shell.kind === "message" && shell.taskId && assembleTasks(events).length > 0;
        const next = applyEvents(events, splitsToTask ? freshShell : shell, localReplyId);
        if (!next.taskId) return;
        latest = next;
        handlers.onUpdate(next);
      },
      onError: handlers.onError,
    },
    signal,
  );
  return latest;
}

/** Reconnects to a running task's stream (`SubscribeToTask`) and folds updates into it. */
export async function runResubscribe(
  task: TrackedTask,
  handlers: { onUpdate: (task: TrackedTask) => void },
  signal?: AbortSignal,
): Promise<void> {
  const events: unknown[] = [];
  await sendAndStream(task.agentId, { taskId: task.taskId, contextId: task.contextId, resubscribe: true }, {
    onEvent: (event) => {
      events.push(event);
      const applied = applyEvents(events, task, task.taskId);
      // The user may have sent a message since this stream opened; don't drop it.
      const latest = useTaskStore.getState().tasks[task.taskId];
      const known = new Set(applied.messages.map((message) => message.id));
      const extra = latest ? latest.messages.filter((message) => !known.has(message.id)) : [];
      handlers.onUpdate(extra.length ? { ...applied, messages: [...applied.messages, ...extra].sort((a, b) => a.timestamp.localeCompare(b.timestamp)) } : applied);
    },
  }, signal);
}
