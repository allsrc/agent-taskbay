"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AssembledArtifact, NormalizedPart } from "@/lib/types";

export interface ThreadMessage {
  id: string;
  role: "user" | "agent";
  parts: NormalizedPart[];
  timestamp: string;
}

export type TaskBucket = "needs-input" | "in-progress" | "completed" | "failed";

export interface TrackedTask {
  taskId: string;
  agentId: string;
  agentName: string;
  contextId?: string;
  state: string;
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
  const normalized = state.replace("TASK_STATE_", "");
  if (["INPUT_REQUIRED", "AUTH_REQUIRED"].includes(normalized)) return "needs-input";
  if (normalized === "COMPLETED") return "completed";
  if (["FAILED", "CANCELED", "REJECTED"].includes(normalized)) return "failed";
  return "in-progress";
}
