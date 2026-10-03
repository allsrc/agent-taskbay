import { z } from "zod";
import type { JsonValue, PushRegistrationRecord, TaskRecord } from "../../domain/persistence-model";
import type { PushCredentials, PushUnitOfWork } from "../ports/push";
import { PushReceiptError } from "../ports/push";
import { object } from "./task-projection";

const nonempty = z.string().min(1).max(255);
const parts = z.array(z.object({ text: z.string().optional(), raw: z.string().optional(), url: z.string().optional(),
  data: z.unknown().optional(), file: z.object({ bytes: z.string().optional(), uri: z.string().optional() }).passthrough().optional(),
}).passthrough());
const message = z.object({ messageId: nonempty, role: z.enum(["ROLE_AGENT", "ROLE_USER", "agent", "user"]),
  parts, taskId: z.string().optional(), contextId: z.string().optional() }).passthrough();
const status = z.object({ state: z.enum(["TASK_STATE_UNSPECIFIED", "TASK_STATE_SUBMITTED", "TASK_STATE_WORKING",
  "TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED", "TASK_STATE_COMPLETED", "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"]), timestamp: z.iso.datetime({ offset: true }).optional(), message: message.optional() }).passthrough();
const artifact = z.object({ artifactId: nonempty, parts }).passthrough();
const task = z.object({ id: nonempty, status, contextId: z.string().optional(), history: z.array(message).optional(), artifacts: z.array(artifact).optional() }).passthrough();
const schemas = {
  task, message: message.extend({ taskId: nonempty }),
  statusUpdate: z.object({ taskId: nonempty, status, contextId: z.string().optional() }).passthrough(),
  artifactUpdate: z.object({ taskId: nonempty, artifact, append: z.boolean().optional(), lastChunk: z.boolean().optional(), contextId: z.string().optional() }).passthrough(),
};

/** A2A 1.0 StreamResponse; v0.3 explicitly supports full Task snapshots only. */
export function validatePushEvent(input: unknown, expected: TaskRecord): JsonValue {
  let envelope = object(input);
  if (envelope.kind === "task") {
    const legacyStatus = object(envelope.status);
    const state = String(legacyStatus.state ?? "").replaceAll("-", "_").toUpperCase();
    const { kind: _kind, ...legacy } = envelope;
    void _kind;
    envelope = { task: { ...legacy, status: { ...legacyStatus, state: `TASK_STATE_${state}` } } };
  }
  const keys = Object.keys(envelope);
  if (keys.length !== 1 || !(keys[0] in schemas)) throw new PushReceiptError("Invalid push event envelope.", 400);
  const key = keys[0] as keyof typeof schemas;
  const parsed = schemas[key].safeParse(envelope[key]);
  if (!parsed.success) throw new PushReceiptError("Invalid push event payload.", 400);
  const subject = object(parsed.data);
  if ((key === "task" ? subject.id : subject.taskId) !== expected.remoteTaskId) throw new PushReceiptError("Unexpected push task identity.", 409);
  const verifyIdentity = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(verifyIdentity); return; }
    if (!value || typeof value !== "object") return;
    const fields = object(value);
    if (typeof fields.taskId === "string" && fields.taskId && fields.taskId !== expected.remoteTaskId ||
      typeof fields.tenant === "string" && fields.tenant !== expected.tenant ||
      expected.remoteContextId && typeof fields.contextId === "string" && fields.contextId && fields.contextId !== expected.remoteContextId) {
      throw new PushReceiptError("Unexpected push scope.", 409);
    }
    // Structured data/metadata and parts are content, not routing identities.
    for (const name of ["history", "status", "message"]) if (fields[name]) verifyIdentity(fields[name]);
  };
  verifyIdentity(subject);
  return { [key]: parsed.data } as JsonValue;
}

export class PushReceiptService {
  constructor(private readonly work: PushUnitOfWork, private readonly credentials: PushCredentials) {}
  async authorize(id: string, authorization: string | null, now = new Date()): Promise<{ registration: PushRegistrationRecord; task: TaskRecord }> {
    return this.work.run(async (ports) => {
      const registration = await ports.push.findById(id);
      if (!registration || !this.credentials.authenticate(registration, authorization) || ["deleted", "failed"].includes(registration.status))
        throw new PushReceiptError("Invalid push authentication.", 401);
      const task = await ports.tasks.findById(registration.organizationId, registration.taskId);
      const agent = task && await ports.agents.findById(registration.organizationId, task.agentId);
      if (!task?.remoteTaskId || !agent?.enabled) throw new PushReceiptError("Invalid push authentication.", 401);
      if (!await ports.push.consumeRate(id, now, 120)) throw new PushReceiptError("Push rate limit exceeded.", 429);
      return { registration, task };
    });
  }
}
