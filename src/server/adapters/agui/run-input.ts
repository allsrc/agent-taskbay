import { z } from "zod";

/** Subset of the AG-UI 1.0 `RunAgentInput` the adapter acts on; other documented fields are accepted and ignored. */
const identifier = z.string().regex(/^[A-Za-z0-9._:-]{1,255}$/, "Must be 1-255 letters, digits or . _ : -");
const contentPart = z.object({ type: z.string() }).passthrough();
const message = z.object({ id: z.string().min(1).max(255), role: z.string(), content: z.union([z.string(), z.array(contentPart)]).optional() }).passthrough();
const resumeEntry = z.object({
  interruptId: z.string().min(1).max(300),
  status: z.enum(["answered", "abandoned"]),
  payload: z.unknown().optional(),
}).passthrough();

export const runInputSchema = z.object({
  threadId: identifier,
  runId: identifier,
  messages: z.array(message).min(1).max(1000),
  resume: z.array(resumeEntry).max(20).optional(),
}).passthrough();

export class RunInputError extends Error {
  readonly status = 400;
}

export type RunPlan =
  | { kind: "send"; threadId: string; runId: string; messageId: string; text: string }
  | { kind: "resume"; threadId: string; runId: string; localTaskId: string; status: "answered" | "abandoned"; payload: unknown };

const INTERRUPT_ID = /^task:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export const interruptIdFor = (localTaskId: string) => `task:${localTaskId}`;

function textOf(content: string | Array<{ type: string; text?: unknown }> | undefined): string {
  if (typeof content === "string") return content;
  const parts = content ?? [];
  const unsupported = parts.find((part) => part.type !== "text");
  if (unsupported) throw new RunInputError(`AG-UI content part "${unsupported.type}" is not supported; send text only.`);
  return parts.map((part) => (typeof part.text === "string" ? part.text : "")).join("\n");
}

/** Validates the request body and decides what the run must do. Everything else in the input is ignored by design. */
export function planRun(body: unknown): RunPlan {
  const parsed = runInputSchema.safeParse(body);
  if (!parsed.success) throw new RunInputError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; "));
  const { threadId, runId, messages, resume } = parsed.data;
  if (resume?.length) {
    if (resume.length !== 1) throw new RunInputError("resume must answer the single open interrupt of the previous run.");
    const entry = resume[0];
    const match = INTERRUPT_ID.exec(entry.interruptId);
    if (!match) throw new RunInputError("resume names an unknown interrupt.");
    return { kind: "resume", threadId, runId, localTaskId: match[1], status: entry.status, payload: entry.payload };
  }
  const last = messages.at(-1)!;
  if (last.role !== "user") throw new RunInputError("The last message must be a user message.");
  const text = textOf(last.content as string | Array<{ type: string; text?: unknown }> | undefined);
  if (!text.trim()) throw new RunInputError("The user message has no text.");
  return { kind: "send", threadId, runId, messageId: last.id, text };
}

/** Command-API input for an answered interrupt: strings reply as text, anything else as one JSON data part. */
export function answerParts(payload: unknown): Array<Record<string, unknown>> {
  if (typeof payload === "string") {
    if (!payload.trim()) throw new RunInputError("An answered interrupt needs a payload.");
    return [{ text: payload, mediaType: "text/plain" }];
  }
  if (payload === undefined || payload === null) throw new RunInputError("An answered interrupt needs a payload.");
  return [{ data: payload, mediaType: "application/json" }];
}
