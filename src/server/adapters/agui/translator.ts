import type { DurableTaskView, ThreadMessage } from "@/shared/task-types";
import type { NormalizedPart } from "@/lib/types";
import { stateName } from "@/lib/task-view";
import { STRUCTURED_FORM_EXTENSION_URI, STRUCTURED_FORM_MEDIA_TYPE, formFromPart } from "@/lib/structured-form";
import { interruptIdFor } from "./run-input";

export type AgUiEvent = { type: string; timestamp: number; [key: string]: unknown };

const MAX_PART_BYTES = 64 * 1024;
const text = (message: ThreadMessage) => message.parts.filter((part) => part.kind === "text" && typeof part.value === "string").map((part) => part.value as string).join("\n");

/**
 * Translates committed task views into one valid AG-UI run: RUN_STARTED first, new agent messages once each,
 * a state snapshot per state change, and exactly one terminal event. Pure and clock-injected so it is unit-testable.
 */
export class RunTranslator {
  private readonly seenMessages: Set<string>;
  private readonly seenArtifacts = new Set<string>();
  private state: string | undefined;
  private finished = false;

  constructor(
    private readonly run: { threadId: string; runId: string },
    /** Agent message ids already on the task before this run started (resume), never replayed. */
    baseline: Iterable<string> = [],
    private readonly options: { advertisedExtensions?: readonly string[]; now?: () => number } = {},
  ) { this.seenMessages = new Set(baseline); }

  private event(type: string, fields: Record<string, unknown> = {}): AgUiEvent { return { type, ...fields, timestamp: (this.options.now ?? Date.now)() }; }

  start(): AgUiEvent[] { return [this.event("RUN_STARTED", { threadId: this.run.threadId, runId: this.run.runId })]; }

  /** Events for everything new in `view`. Safe to call repeatedly with the same or a later view. */
  observe(view: DurableTaskView): AgUiEvent[] {
    if (this.finished) return [];
    const events: AgUiEvent[] = [];
    const current = stateName(view.state);
    if (current !== this.state) {
      this.state = current;
      events.push(this.event("STATE_SNAPSHOT", { snapshot: { taskId: view.localId, remoteTaskId: view.taskId, contextId: view.contextId ?? null, state: current } }));
    }
    for (const message of view.messages) {
      if (message.role !== "agent" || this.seenMessages.has(message.id)) continue;
      this.seenMessages.add(message.id);
      const body = text(message);
      if (body) events.push(this.event("TEXT_MESSAGE_START", { messageId: message.id, role: "assistant" }),
        this.event("TEXT_MESSAGE_CONTENT", { messageId: message.id, delta: body }), this.event("TEXT_MESSAGE_END", { messageId: message.id }));
      for (const part of message.parts) if (part.kind !== "text") events.push(this.event("CUSTOM", { name: "a2a.part", value: this.partValue(message.id, part) }));
    }
    for (const artifact of view.artifacts) {
      const key = `${artifact.artifactId}:${artifact.updateCount}`;
      if (!artifact.complete || this.seenArtifacts.has(key)) continue;
      this.seenArtifacts.add(key);
      events.push(this.event("CUSTOM", { name: "a2a.artifact", value: { artifactId: artifact.artifactId, name: artifact.name ?? null,
        parts: artifact.parts.map((part) => this.partValue(undefined, part)) } }));
    }
    return events;
  }

  private partValue(messageId: string | undefined, part: NormalizedPart) {
    const big = part.kind === "data" && JSON.stringify(part.value ?? null).length > MAX_PART_BYTES;
    return { ...(messageId ? { messageId } : {}), kind: part.kind, mediaType: part.mediaType, ...(part.filename ? { filename: part.filename } : {}),
      // Raw and URL parts carry the console's own download link, never inline bytes.
      ...(big ? { truncated: true } : { value: part.value ?? null }) };
  }

  /** The single terminal event for a settled view. */
  finish(view: DurableTaskView): AgUiEvent[] {
    if (this.finished) return [];
    this.finished = true;
    const current = stateName(view.state);
    const base = { threadId: this.run.threadId, runId: this.run.runId };
    if (current === "INPUT_REQUIRED" || current === "AUTH_REQUIRED") {
      const prompts = view.messages.filter((message) => message.role === "agent" && message.fromStatus);
      const prompt = prompts.at(-1);
      const formPart = prompt?.parts.find((part) => part.kind === "data" && part.mediaType === STRUCTURED_FORM_MEDIA_TYPE);
      const form = formPart && formFromPart(formPart, this.options.advertisedExtensions ?? []);
      const raw = form && formPart && typeof formPart.value === "object" && formPart.value ? (formPart.value as { schema?: unknown }).schema : undefined;
      return [this.event("RUN_FINISHED", { ...base, outcome: { type: "interrupt", interrupts: [{
        id: interruptIdFor(view.localId), reason: current === "INPUT_REQUIRED" ? "input_required" : "auth_required",
        message: (prompt ? text(prompt) : "") || (current === "INPUT_REQUIRED" ? "The agent needs more input." : "The agent needs authorization."),
        ...(raw ? { responseSchema: raw } : {}),
        metadata: { taskId: view.taskId, formExtension: raw ? STRUCTURED_FORM_EXTENSION_URI : undefined },
      }] } })];
    }
    if (current === "COMPLETED" || current === "MESSAGE_ONLY") return [this.event("RUN_FINISHED", { ...base, outcome: { type: "success" } })];
    if (current === "CANCELED") return [this.event("RUN_FINISHED", { ...base, outcome: { type: "cancelled" } })];
    if (current === "FAILED" || current === "REJECTED") {
      const last = view.messages.filter((message) => message.role === "agent").at(-1);
      return [this.event("RUN_ERROR", { message: (last && text(last)) || `The task ${current.toLowerCase()}.`, code: current })];
    }
    return [this.event("RUN_ERROR", { message: "The task is not in a settled state.", code: "unsettled" })];
  }

  /** A terminal error for failures outside the task (command failed, window elapsed, storage unavailable). */
  error(message: string, code: string): AgUiEvent[] {
    if (this.finished) return [];
    this.finished = true;
    return [this.event("RUN_ERROR", { message, code })];
  }

  get done() { return this.finished; }
  /** Agent messages emitted so far that were not on the task before the run (baseline excluded). */
  get agentMessagesSeen() { return this.seenMessages.size; }
}
