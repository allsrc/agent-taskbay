import type { Tone } from "./tone";
import type { ThreadMessage, TrackedTask } from "../shared/task-types";

const bare = (state: string) => state.replace("TASK_STATE_", "");

/** Upper-case wire name without the `TASK_STATE_` prefix, e.g. INPUT_REQUIRED. */
export const stateName = (state: string) => bare(state);

export const STATE_TONE: Record<string, Tone> = {
  SUBMITTED: "neutral",
  WORKING: "brand",
  INPUT_REQUIRED: "warning",
  AUTH_REQUIRED: "info",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELED: "neutral",
  REJECTED: "danger",
  MESSAGE_ONLY: "neutral",
};

/** Sentence-case label for a wire state, e.g. INPUT_REQUIRED becomes "Input required". */
export const stateLabel = (state: string) => {
  const name = bare(state);
  if (name === "MESSAGE_ONLY") return "Message";
  const text = name.toLowerCase().replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
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
  // A task another system started has no message from a person to name it: use what the agent said, then a short ID, never the agent's name.
  const fallback = task.origin === "discovered" ? firstText(task.messages) ?? `Task ${task.taskId.slice(0, 8)}` : task.agentName;
  const text = task.title ?? firstText(task.messages, "user") ?? fallback;
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
