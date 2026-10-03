"use client";

import type { DurableTaskView } from "../shared/task-types";
import { sendAndStream } from "./client-stream";
import type { OutgoingPart } from "./message-parts";
import { type SendConfig, type ThreadMessage, type TrackedTask } from "../store/task-store";

export { userThreadMessage } from "./track-events";

export interface RunSendInput {
  skillId?: string;
  agentId: string;
  agentName: string;
  parts: OutgoingPart[];
  /** Set to continue an open task; omit to start a new task (optionally inside `contextId`). */
  taskId?: string;
  contextId?: string;
  tenant?: string;
  config?: SendConfig;
  userMessage: ThreadMessage;
  /** Existing tracked task being continued; new sends start from an empty shell. */
  base?: TrackedTask;
}

/** Sends durable intent and reports only committed projections. Wire events are diagnostic. */
export async function runSend(
  input: RunSendInput,
  handlers: { onUpdate: (task: DurableTaskView) => void; onError?: (message: string) => void; onRawEvent?: (event: unknown) => void },
  signal?: AbortSignal,
): Promise<DurableTaskView | undefined> {
  let latest: DurableTaskView | undefined;
  await sendAndStream(input.agentId, {
    skillId: input.skillId, parts: input.parts, taskId: input.taskId, contextId: input.contextId,
    config: input.config, messageId: input.userMessage.id, tenant: input.tenant ?? input.base?.tenant,
  }, {
    onAccepted: (commandId) => handlers.onRawEvent?.({ commandAccepted: { commandId } }),
    onSnapshot: (task) => { latest = task; handlers.onUpdate(task); },
    onEvent: handlers.onRawEvent,
    onError: handlers.onError,
  }, signal);
  return latest;
}

/** Compatibility diagnostic view; remote observation remains worker-owned. */
export async function runResubscribe(
  task: TrackedTask,
  handlers: { onUpdate: (task: DurableTaskView) => void },
  signal?: AbortSignal,
): Promise<void> {
  await sendAndStream(task.agentId, {
    taskId: task.taskId, contextId: task.contextId, resubscribe: true, tenant: task.tenant,
  }, { onSnapshot: handlers.onUpdate }, signal);
}
