import type { DurableTaskView } from "../../../shared/task-types";
import type { TaskRecord } from "../../domain/persistence-model";
import type { TaskLinkRepository } from "../ports/task-links";

/** Message references form a graph, never an inferred hierarchy or an instruction to fetch another task. */
export async function recordTaskLinks(links: TaskLinkRepository, task: TaskRecord, view: DurableTaskView, now: Date) {
  const references = [...new Set(view.messages.flatMap((message) => message.referenceTaskIds ?? []))]
    .filter((id) => typeof id === "string" && id.length > 0 && id.length <= 512);
  if (references.length) await links.recordReferences(task, references, now);
}
