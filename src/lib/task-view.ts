import type { ThreadMessage, TrackedTask } from "../store/task-store";

const bare = (state: string) => state.replace("TASK_STATE_", "");

/** Upper-case wire name without the `TASK_STATE_` prefix, e.g. INPUT_REQUIRED. */
export const stateName = (state: string) => bare(state);

export const STATE_COLOR: Record<string, string> = {
  SUBMITTED: "text-muted-foreground bg-muted-foreground/15",
  WORKING: "text-primary bg-primary/15",
  INPUT_REQUIRED: "text-warning bg-warning/15",
  AUTH_REQUIRED: "text-auth bg-auth/15",
  COMPLETED: "text-success bg-success/15",
  FAILED: "text-brand bg-brand/15",
  CANCELED: "text-muted-foreground bg-muted-foreground/15",
  REJECTED: "text-brand bg-brand/15",
  MESSAGE_ONLY: "text-muted-foreground bg-muted-foreground/15",
};

export const STATE_DOT: Record<string, string> = {
  SUBMITTED: "bg-muted-foreground",
  WORKING: "bg-primary",
  INPUT_REQUIRED: "bg-warning",
  AUTH_REQUIRED: "bg-auth",
  COMPLETED: "bg-success",
  FAILED: "bg-brand",
  CANCELED: "bg-muted-foreground",
  REJECTED: "bg-brand",
};

export function firstText(messages: ThreadMessage[], role?: ThreadMessage["role"]): string | undefined {
  for (const message of messages) {
    if (role && message.role !== role) continue;
    const part = message.parts.find((candidate) => candidate.kind === "text" && String(candidate.value).trim());
    if (part) return String(part.value).trim();
  }
  return undefined;
}

/** A task's display title: what the user first asked for. */
export function taskTitle(task: TrackedTask, max = 60): string {
  const text = firstText(task.messages, "user") ?? task.agentName;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export const isActiveState = (state: string) =>
  ["SUBMITTED", "WORKING", "INPUT_REQUIRED", "AUTH_REQUIRED"].includes(bare(state));
export const needsYou = (state: string) => ["INPUT_REQUIRED", "AUTH_REQUIRED"].includes(bare(state));

export function referencesOf(task: TrackedTask): string[] {
  return [...new Set(task.messages.flatMap((message) => message.referenceTaskIds ?? []))];
}
