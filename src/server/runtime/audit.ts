import { authorize } from "../application/services/authorization";
import type { MikroORM } from "@mikro-orm/core";
import { z } from "zod";
import { withJobEntityManager } from "../adapters/db/orm";
import { MikroOrmAuditRepository, encodeCursor } from "../adapters/db/audit-repository";
import type { AuditGroup, AuditPorts, AuditRow, AuditUnitOfWork } from "../application/ports/audit";
import { AuditQueryService, AuditError } from "../application/services/audit-query";
import type { Principal } from "../application/ports/identity";
import { sharedPorts } from "./shared-ports";

export const auditQuerySchema = z.object({
  taskId: z.string().uuid().optional(), group: z.enum(["all", "approvals", "ownership", "commands", "access"]).default("all"),
  actor: z.string().uuid().optional(), since: z.string().datetime().optional(), until: z.string().datetime().optional(),
  cursor: z.string().max(400).optional(), limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();

export function parseAuditQuery(params: URLSearchParams) {
  const parsed = auditQuerySchema.safeParse(Object.fromEntries([...params].filter(([, value]) => value !== "")));
  if (!parsed.success) throw new AuditError(parsed.error.issues.map((issue) => issue.message).join("; "), 400);
  const { actor, since, until, ...rest } = parsed.data;
  return { ...rest, group: rest.group as AuditGroup, actorUserId: actor, since: since ? new Date(since) : undefined, until: until ? new Date(until) : undefined };
}

function ports(em: Parameters<Parameters<typeof withJobEntityManager>[0]>[0]): AuditPorts {
  const shared = sharedPorts(em);
  return { audit: new MikroOrmAuditRepository(em), tasks: shared.tasks, canRead: shared.canRead, names: shared.names, taskContext: shared.taskContext };
}
export function auditUnitOfWork(options: { orm?: MikroORM } = {}): AuditUnitOfWork {
  // Read-only: a single consistent snapshot per page, never a write.
  return { run: (work) => withJobEntityManager((em) => em.transactional((transaction) => work(ports(transaction)), { readOnly: true }), options.orm) };
}
export const createAuditService = (options: { orm?: MikroORM } = {}) => new AuditQueryService(auditUnitOfWork(options), encodeCursor);

export type AuditPage = Awaited<ReturnType<AuditQueryService["page"]>>;

/** `kind` is the machine name; the browser words it. People are named only if they belong to this organization. */
export function auditView(page: AuditPage, principal: Principal) {
  return {
    entries: page.entries.map((row: AuditRow) => ({ key: row.key, at: row.at.toISOString(), kind: row.kind, actorUserId: row.actorUserId, taskId: row.taskId,
      subjectId: row.subjectId, data: row.data })),
    people: page.people, context: page.context, next: page.next, viewer: { userId: principal.userId, membershipId: principal.membershipId, role: principal.role },
  };
}

/** Spreadsheet formulas in attacker-influenced text (titles, rationales) must never execute when exported. */
export const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export function auditCsv(page: AuditPage) {
  const header = ["time", "kind", "actor", "task", "subject", "detail"];
  const rows = page.entries.map((row) => [row.at.toISOString(), row.kind, row.actorUserId ? page.people[row.actorUserId] ?? row.actorUserId : "system",
    row.taskId ?? "", row.subjectId ?? "", row.data]);
  return [header, ...rows].map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** A browser-reported run summary. Individual command facts remain the execution authority. */
export const cancelRelatedAuditSchema = z.object({
  runId: z.string().uuid(), requested: z.number().int().min(1).max(1000),
  canceled: z.number().int().min(0).max(1000), refused: z.number().int().min(0).max(1000), failed: z.number().int().min(0).max(1000),
}).strict().refine((value) => value.requested === value.canceled + value.refused + value.failed, "Result counts must equal requested.");

export async function recordCancelRelatedAudit(principal: Principal, taskId: string, input: unknown, options: { orm?: MikroORM } = {}) {
  const parsed = cancelRelatedAuditSchema.safeParse(input);
  if (!parsed.success || !z.string().uuid().safeParse(taskId).success) throw new AuditError("Invalid cancel summary.", 400);
  authorize(principal, "operate");
  return withJobEntityManager((em) => em.transactional(async (tx) => {
    const shared = sharedPorts(tx);
    const task = await shared.tasks.findById(principal.organizationId, taskId);
    if (!task || !await shared.canRead(principal, task.agentId, task.skillId ?? null)) throw new AuditError("Task not found.", 404);
    const { runId, ...counts } = parsed.data;
    // Existing immutable audit storage accepts a text target. This fixed JSON holds only the subject and counts.
    await shared.audit(principal, principal.organizationId, "task.cancel.related", JSON.stringify({ taskId, ...counts }),
      `cancel-related:${principal.organizationId}:${principal.membershipId}:${taskId}:${runId}`);
  }), options.orm);
}
