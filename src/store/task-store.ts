"use client";

import { create } from "zustand";
import { MESSAGE_ONLY_STATE } from "../shared/task-types";
import type { DurableTaskView, TaskBucket } from "../shared/task-types";
export type { ThreadMessage, StatusTransition, SendConfig, TrackedKind, TaskBucket, TrackedTask } from "../shared/task-types";
export { MESSAGE_ONLY_STATE } from "../shared/task-types";

interface TaskStoreState {
  tasks: Record<string, DurableTaskView>;
  loaded: boolean;
  error?: string;
  revision: number;
  upsertTask: (task: DurableTaskView) => void;
  replaceTasks: (tasks: DurableTaskView[], expectedRevision: number) => boolean;
  fail: (message: string) => void;
}

/** Disposable server projection cache. Pending user turns live only in the composer. */
export const useTaskStore = create<TaskStoreState>()((set, get) => ({
  tasks: {}, loaded: false, revision: 0,
  upsertTask: (task) => set((state) => {
    const current = state.tasks[task.localId];
    if (current?.version !== undefined && (task.version === undefined || task.version < current.version)) return state;
    return { tasks: { ...state.tasks, [task.localId]: task }, revision: state.revision + 1 };
  }),
  replaceTasks: (tasks, expectedRevision) => {
    // A send can commit while a paginated read is in flight. Read again before
    // replacing, so an earlier page cannot erase the new committed snapshot.
    if (get().revision !== expectedRevision) return false;
    set({ tasks: Object.fromEntries(tasks.map((task) => [task.localId, task])), loaded: true, error: undefined });
    return true;
  },
  fail: (error) => set({ error }),
}));

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
