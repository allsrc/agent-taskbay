"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AssembledArtifact, NormalizedPart } from "@/lib/types";

export interface ThreadMessage {
  /** A2A `messageId` when the wire message carried one; otherwise a UI-local id. */
  id: string;
  role: "user" | "agent";
  parts: NormalizedPart[];
  timestamp: string;
  contextId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
  /** Tasks this message referenced via `referenceTaskIds`. */
  referenceTaskIds?: string[];
  /** True when this message is the agent's question/prompt attached to an INPUT_REQUIRED / AUTH_REQUIRED status. */
  fromStatus?: boolean;
}

export interface StatusTransition {
  state: string;
  timestamp: string;
}

/** Per-send execution preferences (A2A `SendMessageConfiguration` + request metadata). */
export interface SendConfig {
  returnImmediately?: boolean;
  historyLength?: number;
  acceptedOutputModes?: string[];
  referenceTaskIds?: string[];
  metadata?: Record<string, unknown>;
  requestMetadata?: Record<string, unknown>;
}

/**
 * `task`: the agent created a stateful Task (has a lifecycle, artifacts).
 * `message`: the agent answered with a plain Message and no Task -- a direct reply.
 */
export type TrackedKind = "task" | "message";

export type TaskBucket = "needs-input" | "in-progress" | "completed" | "failed" | "replies";

export const MESSAGE_ONLY_STATE = "MESSAGE_ONLY";

export interface TrackedTask {
  taskId: string;
  agentId: string;
  agentName: string;
  contextId?: string;
  kind?: TrackedKind;
  state: string;
  /** Status history (SUBMITTED -> WORKING -> ...), oldest first. */
  transitions?: StatusTransition[];
  createdAt: string;
  updatedAt: string;
  messages: ThreadMessage[];
  artifacts: AssembledArtifact[];
}

interface TaskStoreState {
  tasks: Record<string, TrackedTask>;
  upsertTask: (task: TrackedTask) => void;
  patchTask: (taskId: string, patch: Partial<Omit<TrackedTask, "taskId">>) => void;
}

/**
 * Client-local, resume-on-refresh task state (design doc §4.4's original
 * framing). This is explicitly a placeholder for the durable, org/role-scoped
 * server-side task store required by §7.2.4/§7.1 once tasks are shared or
 * routed between people -- see README "What's not built yet".
 */
export const useTaskStore = create<TaskStoreState>()(
  persist(
    (set) => ({
      tasks: {},
      upsertTask: (task) => set((store) => ({ tasks: { ...store.tasks, [task.taskId]: task } })),
      patchTask: (taskId, patch) => set((store) => {
        const existing = store.tasks[taskId];
        if (!existing) return store;
        return { tasks: { ...store.tasks, [taskId]: { ...existing, ...patch } } };
      }),
    }),
    { name: "a2a-agent-workflow-ui.tasks" },
  ),
);

export function taskBucket(state: string): TaskBucket {
  if (state === MESSAGE_ONLY_STATE) return "replies";
  const normalized = state.replace("TASK_STATE_", "");
  if (["INPUT_REQUIRED", "AUTH_REQUIRED"].includes(normalized)) return "needs-input";
  if (normalized === "COMPLETED") return "completed";
  if (["FAILED", "CANCELED", "REJECTED"].includes(normalized)) return "failed";
  return "in-progress";
}

export const BUCKET_BADGE: Record<TaskBucket, "warning" | "default" | "success" | "destructive" | "muted"> = {
  "needs-input": "warning",
  "in-progress": "default",
  completed: "success",
  failed: "destructive",
  replies: "muted",
};
