import { beforeEach, expect, it, vi } from "vitest";
import type { DurableTaskView } from "../shared/task-types";
import { useTaskStore } from "./task-store";

const view: DurableTaskView = { localId: "local", tenant: "", taskId: "remote", agentId: "agent", agentName: "Agent", kind: "task",
  state: "TASK_STATE_WORKING", messages: [], artifacts: [], referenceLinks: {}, createdAt: "2026-10-03", updatedAt: "2026-10-03" };
beforeEach(() => {
  useTaskStore.setState({ tasks: {}, loaded: false, error: undefined, revision: 0 });
});

it("REL-002 replaces committed content instead of retaining phantom messages or removed tasks", () => {
  useTaskStore.getState().upsertTask({ ...view, messages: [{ id: "phantom", role: "user", parts: [], timestamp: view.updatedAt }] });
  expect(useTaskStore.getState().replaceTasks([view], 1)).toBe(true);
  expect(useTaskStore.getState().tasks.local.messages).toEqual([]);
  useTaskStore.getState().replaceTasks([], 1);
  expect(useTaskStore.getState()).toMatchObject({ tasks: {}, loaded: true });
});

it("REL-002 fences a paginated refresh that raced a committed send and preserves cache on failure", () => {
  useTaskStore.getState().upsertTask(view);
  expect(useTaskStore.getState().replaceTasks([], 0)).toBe(false);
  useTaskStore.getState().fail("Offline");
  expect(useTaskStore.getState().tasks.local).toEqual(view);
  expect(useTaskStore.getState().replaceTasks([view], 1)).toBe(true);
  expect(useTaskStore.getState().error).toBeUndefined();
});

it("task snapshots never write browser storage (notification read state is durable on the server)", () => {
  const setItem = vi.fn();
  vi.stubGlobal("window", { localStorage: { setItem } });
  try {
    useTaskStore.getState().upsertTask(view);
    expect(setItem).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

it("REL-001 ignores a delayed committed snapshot after a newer server revision", () => {
  useTaskStore.getState().upsertTask({ ...view, version: 3, state: "TASK_STATE_CANCELED" });
  useTaskStore.getState().upsertTask({ ...view, version: 2 });
  expect(useTaskStore.getState().tasks.local.state).toBe("TASK_STATE_CANCELED");
  expect(useTaskStore.getState().revision).toBe(1);
});
