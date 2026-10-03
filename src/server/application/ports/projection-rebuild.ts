import type { TaskEventRecord, TaskRecord } from "../../domain/persistence-model";
import type { DurableTaskView } from "../../../shared/task-types";

export interface ProjectionRebuildSnapshot {
  task: TaskRecord;
  agentName: string;
  events: TaskEventRecord[];
}
export interface ProjectionRebuildRepository {
  capture(organizationId: string, taskId: string): Promise<ProjectionRebuildSnapshot | undefined>;
  /** Compare task version under its lock; stale builds never activate. */
  activate(snapshot: ProjectionRebuildSnapshot, view: DurableTaskView): Promise<boolean>;
}
