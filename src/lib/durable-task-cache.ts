import { fetchJson } from "./conditional-fetch";
import type { DurableTaskView } from "../shared/task-types";

type TaskViewPage = { tasks: DurableTaskView[]; next: string | null; error?: { message?: string } };

/** Complete a refresh before activating it; a failed page preserves the prior cache. */
export async function readDurableTasks(signal: AbortSignal): Promise<DurableTaskView[]> {
  const tasks = new Map<string, DurableTaskView>();
  const cursors = new Set<string>();
  let after: string | null = null;
  do {
    const result: { ok: boolean; body: TaskViewPage } = await fetchJson<TaskViewPage>(
      `/api/task-views?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`, signal);
    const { ok, body: page } = result;
    if (!ok) throw new Error(page.error?.message ?? "Could not load server tasks.");
    for (const task of page.tasks as DurableTaskView[]) tasks.set(task.localId, task);
    after = page.next;
    if (after) {
      if (cursors.has(after)) throw new Error("Task pagination did not advance.");
      cursors.add(after);
    }
  } while (after);
  return [...tasks.values()];
}
