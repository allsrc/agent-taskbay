import type { JsonValue } from "../../domain/persistence-model";
import { object } from "./task-projection";

/** What a person sees when browsing an agent's tasks. Display data only: tracking re-reads the task from the agent. */
export interface RemoteTaskRow {
  taskId: string;
  contextId: string | null;
  state: string;
  updatedAt: string | null;
  title: string | null;
  snippet: string | null;
}

const STATES = ["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING", "TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED", "TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED", "TASK_STATE_UNSPECIFIED"];
export const SNIPPET_LIMIT = 120;
const TITLE_LIMIT = 200;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/** Plain text only: control and direction-override characters removed, whitespace collapsed, cut at `limit` characters. */
export function plainSnippet(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(CONTROL, "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 255;

/** A row for a listed task, or undefined when the entry is not a well-formed task. Anything the agent sent beyond these fields is dropped. */
export function remoteTaskRow(entry: JsonValue): RemoteTaskRow | undefined {
  const task = object(entry);
  const status = object(task.status);
  if (!isId(task.id) || typeof status.state !== "string" || !STATES.includes(status.state)) return undefined;
  const message = object(status.message);
  const text = (Array.isArray(message.parts) ? message.parts : []).map((part) => object(part).text).find((value) => typeof value === "string");
  const timestamp = typeof status.timestamp === "string" && Number.isFinite(Date.parse(status.timestamp)) ? new Date(status.timestamp).toISOString() : null;
  return {
    taskId: task.id, contextId: isId(task.contextId) ? task.contextId : null, state: status.state, updatedAt: timestamp,
    title: plainSnippet(object(task.metadata).title, TITLE_LIMIT), snippet: plainSnippet(text, SNIPPET_LIMIT),
  };
}

/** Splits a page into display rows and a count of entries that were dropped as malformed or for another tenant. */
export function remoteTaskRows(entries: JsonValue[], tenant: string): { rows: RemoteTaskRow[]; dropped: number } {
  const rows: RemoteTaskRow[] = [];
  let dropped = 0;
  for (const entry of entries) {
    const declared = object(object(entry).metadata).tenant;
    const row = typeof declared === "string" && declared !== tenant ? undefined : remoteTaskRow(entry);
    if (row) rows.push(row); else dropped++;
  }
  return { rows, dropped };
}

/** Checks a task read with `GetTask` before it is stored: identity, tenant and state must be what was asked for. */
export function validateTrackedTask(event: JsonValue, taskId: string, tenant: string): string | undefined {
  const task = object(object(event).task);
  if (task.id !== taskId) return "The agent returned a different task.";
  const declared = object(task.metadata).tenant;
  if (typeof declared === "string" && declared !== tenant) return "The agent returned a task for another tenant.";
  if (typeof object(task.status).state !== "string" || !STATES.includes(String(object(task.status).state))) return "The agent returned a task without a valid state.";
  return undefined;
}
