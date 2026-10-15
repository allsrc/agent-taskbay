import type { RelatedTasks } from "../../../shared/task-types";
import type { TaskRecord } from "../../domain/persistence-model";

export interface TaskLinkRepository {
  /** Resolve known remote IDs within the source's organization, agent and tenant; ignore unknown IDs. */
  recordReferences(task: TaskRecord, remoteTaskIds: string[], now: Date): Promise<void>;
  /** Both the source and every returned target must be visible through the caller's task access filter. */
  findRelated(organizationId: string, taskId: string): Promise<RelatedTasks>;
}
