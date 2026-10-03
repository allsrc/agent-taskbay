import type { DurableTaskView } from "../shared/task-types";

/** Complete a refresh before activating it; a failed page preserves the prior cache. */
export async function readDurableTasks(signal: AbortSignal): Promise<DurableTaskView[]> {
  const tasks = new Map<string, DurableTaskView>();
  const cursors = new Set<string>();
  let after: string | null = null;
  do {
    const response = await fetch(`/api/task-views?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`, { cache: "no-store", signal });
    const page: { tasks: DurableTaskView[]; next: string | null; error?: { message?: string } } = await response.json();
    if (!response.ok) throw new Error(page.error?.message ?? "Could not load server tasks.");
    for (const task of page.tasks as DurableTaskView[]) tasks.set(task.localId, task);
    after = page.next;
    if (after) {
      if (cursors.has(after)) throw new Error("Task pagination did not advance.");
      cursors.add(after);
    }
  } while (after);
  return [...tasks.values()];
}

/** Retire only obsolete content/read caches; UI preferences keep their own storage. */
export function retireBrowserTaskPersistence(storage: Pick<Storage, "removeItem">) {
  for (const namespace of ["a2a-agent-workflow-ui", "a2a-ops"]) {
    for (const suffix of ["tasks", "notifications"]) {
      try { storage.removeItem(`${namespace}.${suffix}`); } catch { /* Storage may be disabled. */ }
    }
  }
}
