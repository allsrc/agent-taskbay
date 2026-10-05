import type { MikroORM } from "@mikro-orm/core";
import { z } from "zod";
import { withJobEntityManager } from "../adapters/db/orm";
import { MikroOrmWorkflowRepository } from "../adapters/db/workflow-repository";
import type { WorkflowFilter, WorkflowPorts, WorkflowUnitOfWork } from "../application/ports/workflow";
import { TaskWorkflowService, WorkflowError } from "../application/services/task-workflow";
import type { AssignmentEventRecord, EscalationPolicyRecord, TaskAssignmentRecord, TaskNoteRecord } from "../domain/workflow-model";
import { sharedPorts } from "./shared-ports";
import { requirePrincipal } from "./decisions";

const uuid = z.string().uuid();
export const assignSchema = z.object({ assigneeMembershipId: uuid }).strict();
export const dueSchema = z.object({ dueAt: z.string().datetime().nullable() }).strict();
export const noteSchema = z.object({ body: z.string().min(1).max(4000), noteKey: z.string().min(1).max(255) }).strict();
export const policySchema = z.object({ agentId: uuid.nullable(), targetMembershipId: uuid, enabled: z.boolean() }).strict();

export function parseWorkflowBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new WorkflowError(parsed.error.issues.map((issue) => issue.message).join("; "), 400);
  return parsed.data;
}

type EntityManagerLike = Parameters<Parameters<typeof withJobEntityManager>[0]>[0];
function ports(em: EntityManagerLike): WorkflowPorts {
  const shared = sharedPorts(em);
  return {
    workflow: new MikroOrmWorkflowRepository(em), tasks: shared.tasks, requireOperate: shared.requireOperate, canOperate: shared.canOperate,
    isReviewer: shared.isReviewer, freshen: shared.freshen, notify: shared.notify, audit: shared.audit,
    names: shared.names,
  };
}
export function workflowUnitOfWork(options: { orm?: MikroORM } = {}): WorkflowUnitOfWork {
  return { run: (work) => withJobEntityManager((em) => em.transactional((transaction) => work(ports(transaction))), options.orm) };
}
export const createWorkflowService = (options: { orm?: MikroORM } = {}) => new TaskWorkflowService(workflowUnitOfWork(options));

export const assignmentView = (assignment: TaskAssignmentRecord | null) => assignment ? { assigneeMembershipId: assignment.assigneeMembershipId,
  claimedAt: assignment.claimedAt?.toISOString() ?? null, dueAt: assignment.dueAt?.toISOString() ?? null, escalationLevel: assignment.escalationLevel,
  escalatedAt: assignment.escalatedAt?.toISOString() ?? null, updatedAt: assignment.updatedAt.toISOString() } : null;
export const eventView = (event: AssignmentEventRecord) => ({ id: event.id, kind: event.kind, actorUserId: event.actorUserId, fromMembershipId: event.fromMembershipId,
  toMembershipId: event.toMembershipId, dueAt: event.dueAt?.toISOString() ?? null, createdAt: event.createdAt.toISOString() });
export const noteView = (note: TaskNoteRecord) => ({ id: note.id, authorUserId: note.authorUserId, body: note.body, createdAt: note.createdAt.toISOString() });
export const policyView = (policy: EscalationPolicyRecord) => ({ id: policy.id, agentId: policy.agentId, targetMembershipId: policy.targetMembershipId,
  enabled: policy.enabled, updatedAt: policy.updatedAt.toISOString() });

export async function readWorkflow(taskId: string, options: { orm?: MikroORM } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId)) return undefined;
  const principal = requirePrincipal();
  const detail = await createWorkflowService(options).detail(principal, taskId);
  if (!detail) return undefined;
  return { assignment: assignmentView(detail.assignment), events: detail.events.map(eventView), notes: detail.notes.map(noteView), people: detail.people,
    viewer: { userId: principal.userId, membershipId: principal.membershipId, role: principal.role } };
}

/** Escalation policies with the people they name; administrators only (enforced by the route). */
export async function listPolicies(options: { orm?: MikroORM } = {}) {
  const principal = requirePrincipal();
  return withJobEntityManager(async (em) => {
    const p = ports(em);
    const policies = await p.workflow.policies(principal.organizationId);
    return { policies: policies.map(policyView), people: await p.names(principal.organizationId, [], policies.map((policy) => policy.targetMembershipId)) };
  }, options.orm);
}

export async function workflowTaskIds(filter: WorkflowFilter, options: { orm?: MikroORM } = {}) {
  const principal = requirePrincipal();
  return withJobEntityManager((em) => new MikroOrmWorkflowRepository(em).taskIdsFor(principal.organizationId, filter, principal.membershipId, new Date()), options.orm);
}

/** Assignment summaries for one page of tasks, with the assignee's display name. */
export async function workflowSummaries(taskIds: string[], options: { orm?: MikroORM } = {}) {
  const principal = requirePrincipal();
  return withJobEntityManager(async (em) => {
    const p = ports(em);
    const assignments = await p.workflow.assignmentsFor(principal.organizationId, taskIds);
    const people = await p.names(principal.organizationId, [], assignments.flatMap((assignment) => assignment.assigneeMembershipId ? [assignment.assigneeMembershipId] : []));
    return new Map(assignments.map((assignment) => [assignment.taskId, { assigneeMembershipId: assignment.assigneeMembershipId,
      assigneeName: assignment.assigneeMembershipId ? people[assignment.assigneeMembershipId] ?? null : null,
      dueAt: assignment.dueAt?.toISOString() ?? null, escalationLevel: assignment.escalationLevel }]));
  }, options.orm);
}
