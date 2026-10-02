"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { migrateBrowserStorageKey } from "./storage-key";

migrateBrowserStorageKey("a2a-agent-workflow-ui.tasks", "a2a-ops.tasks");

import { taskStorageKey, MESSAGE_ONLY_STATE } from "../shared/task-types";
import type { TrackedTask, TaskBucket } from "../shared/task-types";
export type { ThreadMessage, StatusTransition, SendConfig, TrackedKind, TaskBucket, TrackedTask } from "../shared/task-types";
export { MESSAGE_ONLY_STATE } from "../shared/task-types";

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
      upsertTask: (task) => set((store) => {
        const key = taskStorageKey(task);
        const tasks = Object.fromEntries(Object.entries(store.tasks).filter(([existingKey, existing]) =>
          existingKey === key || existing.agentId !== task.agentId || (existing.tenant ?? "") !== (task.tenant ?? "") || existing.taskId !== task.taskId));
        return { tasks: { ...tasks, [key]: task } };
      }),
      patchTask: (taskId, patch) => set((store) => {
        const existing = store.tasks[taskId];
        if (!existing) return store;
        return { tasks: { ...store.tasks, [taskId]: { ...existing, ...patch } } };
      }),
    }),
    { name: "a2a-ops.tasks" },
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
