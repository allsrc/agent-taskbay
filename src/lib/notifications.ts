import { firstText, stateName } from "./task-view";
import type { TrackedTask } from "../store/task-store";

export interface AppNotification {
  id: string;
  taskId: string;
  localId?: string;
  title: string;
  body: string;
  kind: "statusUpdate" | "artifactUpdate";
  state: string;
  at: string;
}

const STATUS_TITLES: Record<string, string> = {
  INPUT_REQUIRED: "Input needed",
  AUTH_REQUIRED: "Authorization needed",
  COMPLETED: "Task finished",
  FAILED: "Task failed",
  REJECTED: "Task rejected",
  CANCELED: "Task canceled",
};

/** Derives notification-worthy events from tracked tasks; no server push is involved yet. */
export function deriveNotifications(tasks: TrackedTask[]): AppNotification[] {
  const items: AppNotification[] = [];
  for (const task of tasks) {
    if (task.kind === "message") continue;
    const state = stateName(task.state);
    const title = STATUS_TITLES[state];
    const at = [...(task.transitions ?? [])].reverse().find((item) => stateName(item.state) === state)?.timestamp ?? task.updatedAt;
    if (title) {
      const agentText = firstText(task.messages.filter((message) => message.role === "agent").reverse(), "agent");
      items.push({
        id: `${task.localId ?? JSON.stringify([task.agentId, task.tenant ?? "", task.taskId])}:${state}`,
        taskId: task.taskId,
        localId: task.localId,
        title,
        body: agentText ? `${task.agentName}: ${agentText.slice(0, 140)}` : `${task.agentName} · ${state.toLowerCase().replaceAll("_", " ")}`,
        kind: "statusUpdate",
        state,
        at,
      });
    }
    if (state === "COMPLETED") {
      for (const artifact of task.artifacts.filter((item) => item.complete)) {
        items.push({
          id: `${task.localId ?? JSON.stringify([task.agentId, task.tenant ?? "", task.taskId])}:artifact:${artifact.artifactId}`,
          taskId: task.taskId,
        localId: task.localId,
          title: "Artifact ready",
          body: `${artifact.name ?? artifact.artifactId} is available from ${task.agentName}.`,
          kind: "artifactUpdate",
          state: "COMPLETED",
          at: task.updatedAt,
        });
      }
    }
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}
