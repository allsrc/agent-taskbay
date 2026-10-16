import { CommandFailureError, failureFromError, failureFromResponse, type CommandFailure } from "./command-failure";
import type { OutgoingPart } from "./message-parts";
import type { NormalizedPart } from "./types";

/**
 * "Stop and restart with this instruction": two ordinary commands in sequence, driven from the browser. Step 1 cancels the running task.
 * Step 2 starts a new task in the same context that references the old one, and runs only if the old task is really finished.
 * Nothing here is a server operation of its own; each step is an idempotent command shown on the wire panel like any other.
 */
export type StepStatus = "waiting" | "running" | "done" | "failed" | "skipped";
export interface RestartProgress {
  cancel: { status: StepStatus; failure?: CommandFailure; /** The task was already finished, so there was nothing to cancel. */ alreadyFinished?: boolean };
  start: { status: StepStatus; failure?: CommandFailure };
}
export const initialRestart = (): RestartProgress => ({ cancel: { status: "waiting" }, start: { status: "waiting" } });

export interface RestartSteps {
  /** Restore authorized attachments before canceling; failure must leave the old task running. */
  prepare?(): Promise<void>;
  /** Cancels the task. Rejects with a `CommandFailureError` when the agent refuses or the outcome is uncertain. */
  cancel(): Promise<void>;
  /** Reads the task again and returns its state, or undefined when it cannot be read. */
  readState(): Promise<string | undefined>;
  /** Sends the instruction as a new task in the same context, referencing the old one. Rejects with a `CommandFailureError`. */
  start(): Promise<void>;
}

const FINISHED = ["COMPLETED", "FAILED", "CANCELED", "REJECTED"];
const finished = (state?: string) => state !== undefined && FINISHED.includes(state.replace("TASK_STATE_", ""));

/**
 * Runs the steps from `from` and reports progress after each change. Step 2 never runs unless step 1 left the old task finished:
 * the cancel succeeded and the task reads back as CANCELED, or the agent said the task could no longer be canceled (or Taskbay knew it
 * was finished) and the task reads back as finished. Returns the final progress.
 */
export async function runRestart(steps: RestartSteps, from: "cancel" | "start", onProgress: (progress: RestartProgress) => void, start: RestartProgress = initialRestart()): Promise<RestartProgress> {
  let progress = start;
  const update = (next: Partial<RestartProgress>) => { progress = { ...progress, ...next }; onProgress(progress); };
  if (from === "cancel") {
    update({ cancel: { status: "running" }, start: { status: "waiting" } });
    let alreadyFinished = false;
    try { await steps.prepare?.(); await steps.cancel(); } catch (cause) {
      const failure = failureFromError(cause, "The task could not be canceled.");
      if (failure.kind !== "task_terminal" && failure.kind !== "task_not_cancelable") { update({ cancel: { status: "failed", failure }, start: { status: "skipped" } }); return progress; }
      alreadyFinished = true;
    }
    const state = await steps.readState().catch(() => undefined);
    const canceled = alreadyFinished ? finished(state) : state?.replace("TASK_STATE_", "") === "CANCELED";
    if (!canceled) {
      const failure: CommandFailure = alreadyFinished
        ? { kind: "task_not_cancelable", message: "The agent says the task cannot be canceled, and it is still running." }
        : { message: state === undefined ? "Taskbay could not read the task after canceling it." : "The agent accepted the cancel, but the task is not canceled." };
      update({ cancel: { status: "failed", failure }, start: { status: "skipped" } });
      return progress;
    }
    update({ cancel: { status: "done", alreadyFinished } });
  }
  update({ start: { status: "running" } });
  try { if (from === "start") await steps.prepare?.(); await steps.start(); } catch (cause) {
    update({ start: { status: "failed", failure: failureFromError(cause, "The new task could not be started.") } });
    return progress;
  }
  update({ start: { status: "done" } });
  return progress;
}

/** A definite refusal permits a new command. Unknown outcomes keep their identity for reconciliation. */
export function restartMessageId(original: string, previous?: string, failure?: CommandFailure): string {
  const refused = failure?.kind && ["task_not_found", "task_not_cancelable", "push_not_supported", "unsupported_operation",
    "content_type_not_supported", "extended_card_not_configured", "extension_required", "version_not_supported", "invalid_request", "task_terminal", "dispatch_failed"].includes(failure.kind);
  return refused ? `restart-${crypto.randomUUID()}` : previous ?? `restart-${original}`;
}

const ARCHIVED_FILE = /^\/api\/artifacts\/[0-9a-f]{64}$/;
// The command endpoint accepts at most 16 MiB after JSON/base64 encoding. Reject oversized restored inputs before stopping work.
const MAX_RESTART_BYTES = 16 * 1024 * 1024;

/** Read stored files through the existing authenticated artifact route. External agent URLs remain references. */
export async function restoreRestartAttachments(parts: OutgoingPart[]): Promise<OutgoingPart[]> {
  const restored: OutgoingPart[] = [];
  for (const part of parts) {
    if (!("url" in part) || !ARCHIVED_FILE.test(part.url)) { restored.push(part); continue; }
    const response = await fetch(part.url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error("The attached file could not be loaded. Check your access and try again.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length * 4 / 3 > MAX_RESTART_BYTES) throw new Error("The attached file is too large to restart with.");
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    restored.push({ raw: btoa(binary), mediaType: part.mediaType, filename: part.filename ?? "file" });
  }
  if (new TextEncoder().encode(JSON.stringify(restored)).length > MAX_RESTART_BYTES - 64 * 1024)
    throw new Error("The instruction and attached files are too large to restart with.");
  return restored;
}

/** What can be resent from a message already shown: text, structured data and files by reference. Anything Taskbay cannot read back is left out. */
export function outgoingFromParts(parts: NormalizedPart[]): OutgoingPart[] {
  const out: OutgoingPart[] = [];
  for (const part of parts) {
    if (part.kind === "text") out.push({ text: String(part.value), mediaType: part.mediaType || "text/plain" });
    else if (part.kind === "data") out.push({ data: part.value, mediaType: part.mediaType || "application/json" });
    else if (part.kind === "url") out.push({ url: String(part.value), mediaType: part.mediaType, ...(part.filename ? { filename: part.filename } : {}) });
    else if (part.kind === "raw") out.push({ raw: String(part.value), mediaType: part.mediaType, filename: part.filename ?? "file" });
  }
  return out;
}

/** The cancel route with one fixed idempotency key, so a second click or a reload cannot create a second cancel command. */
export async function cancelOverHttp(task: { agentId: string; taskId: string; tenant?: string }, idempotencyKey: string): Promise<void> {
  const response = await fetch(`/api/agents/${task.agentId}/tasks/${encodeURIComponent(task.taskId)}/cancel?tenant=${encodeURIComponent(task.tenant ?? "")}`,
    { method: "POST", headers: { "Idempotency-Key": idempotencyKey } });
  if (!response.ok) {
    const failure = await failureFromResponse(response, "Failed to cancel the task.");
    throw new CommandFailureError(failure.message, failure);
  }
}
