import type { MikroORM } from "@mikro-orm/core";
import { z } from "zod";
import { withJobEntityManager } from "../adapters/db/orm";
import { MikroOrmDecisionRepository } from "../adapters/db/decision-repository";
import { requestAccessPolicy } from "../adapters/db/security-repository";
import { AgentEntity, MembershipEntity, TaskEntity, UserEntity } from "../adapters/db/entities";
import { currentPrincipal } from "../adapters/auth/principal-context";
import { AuthenticationError } from "../application/services/authorization";
import { DecisionError, DecisionService, loadDecisionDetail } from "../application/services/decisions";
import type { DecisionPorts, DecisionUnitOfWork } from "../application/ports/decisions";
import type { Principal } from "../application/ports/identity";
import type { ProposedAction, DecisionExecutionRecord, DecisionRecord, DecisionRequestRecord, DecisionRevisionRecord } from "../domain/decision-model";
import type { ArtifactStore } from "../application/ports/artifact-store";
import type { JsonValue } from "../domain/persistence-model";
import { acceptCommandWithin } from "./commands";
import { sharedPorts } from "./shared-ports";

const actionSchema = z.object({ kind: z.literal("send_message"), text: z.string().min(1).max(20_000),
  data: z.record(z.string(), z.unknown()).optional() }).strict();
const outcome = z.enum(["approve", "reject", "edit", "request_changes", "delegate"]);
const uuid = z.string().uuid();

export const openDecisionSchema = z.object({
  taskId: uuid, requestKey: z.string().min(1).max(255).optional(), title: z.string().min(1).max(300), summary: z.string().max(4000).default(""),
  risk: z.enum(["low", "medium", "high"]).default("medium"), action: actionSchema, expiresAt: z.string().datetime(),
  assignedMembershipId: uuid.nullish(),
  policy: z.object({ allowedOutcomes: z.array(outcome).min(1).optional(), separationOfDuties: z.boolean().optional() }).strict().optional(),
}).strict();
export const reviseDecisionSchema = z.object({ action: actionSchema, expectedRevision: z.number().int().min(1) }).strict();
export const decideSchema = z.object({ outcome, rationale: z.string().max(4000).default(""), expectedRevision: z.number().int().min(1),
  edit: actionSchema.optional(), delegateMembershipId: uuid.optional() }).strict();

/** The schema already bounds the action; this only narrows the parsed JSON for the domain type. */
export const toAction = (action: z.infer<typeof actionSchema>): ProposedAction => ({ kind: action.kind, text: action.text,
  ...(action.data ? { data: JSON.parse(JSON.stringify(action.data)) as Record<string, JsonValue> } : {}) });

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new DecisionError(parsed.error.issues.map((issue) => issue.message).join("; "), 400);
  return parsed.data;
}

export function requirePrincipal(): Principal {
  const principal = currentPrincipal();
  if (!principal) throw new AuthenticationError();
  return principal;
}

function ports(em: Parameters<Parameters<typeof withJobEntityManager>[0]>[0], store?: ArtifactStore): DecisionPorts {
  const shared = sharedPorts(em);
  return {
    decisions: new MikroOrmDecisionRepository(em), tasks: shared.tasks, commands: shared.commands,
    requireOperate: shared.requireOperate, canRead: shared.canRead, canOperate: shared.canOperate, freshen: shared.freshen, audit: shared.audit,
    acceptCommand: (input) => acceptCommandWithin(em, { organizationId: input.organizationId, agentId: input.agentId, tenant: input.tenant,
      action: "send", skillId: input.skillId ?? undefined, idempotencyKey: input.idempotencyKey, store,
      input: { text: input.text, taskId: input.taskRemoteId, ...(input.contextId ? { contextId: input.contextId } : {}), messageId: input.messageId },
      params: JSON.parse(JSON.stringify({ text: input.text, taskId: input.taskRemoteId, messageId: input.messageId, returnImmediately: true,
        ...(input.contextId ? { contextId: input.contextId } : {}), ...(input.data ? { metadata: { decision: input.data } } : {}) })) as Record<string, JsonValue> }),
  };
}

export function decisionUnitOfWork(options: { orm?: MikroORM; store?: ArtifactStore } = {}): DecisionUnitOfWork {
  return { run: (work) => withJobEntityManager((em) => em.transactional((transaction) => work(ports(transaction, options.store))), options.orm) };
}
export const createDecisionService = (options: { orm?: MikroORM; store?: ArtifactStore } = {}) => new DecisionService(decisionUnitOfWork(options));

export interface RequestContext { agentName: string; taskTitle: string | null; taskState: string | null; taskRemoteId: string | null }

/** Display-only names for requests the caller can already see; no extra access is granted by them. */
async function contextFor(em: Parameters<Parameters<typeof withJobEntityManager>[0]>[0], organizationId: string, requests: DecisionRequestRecord[]) {
  const agentIds = [...new Set(requests.map((request) => request.agentId))];
  const taskIds = [...new Set(requests.map((request) => request.taskId))];
  const agents = agentIds.length ? await em.find(AgentEntity, { organizationId, id: { $in: agentIds } }) : [];
  const tasks = taskIds.length ? await em.find(TaskEntity, { organizationId, id: { $in: taskIds } }) : [];
  return new Map(requests.map((request): [string, RequestContext] => {
    const agent = agents.find((candidate) => candidate.id === request.agentId);
    const task = tasks.find((candidate) => candidate.id === request.taskId);
    return [request.id, { agentName: agent?.displayName ?? agent?.cardUrl ?? "Agent", taskTitle: task?.title ?? null,
      taskState: task?.state ?? null, taskRemoteId: task?.remoteTaskId ?? null }];
  }));
}

export function requestView(request: DecisionRequestRecord, context?: RequestContext) {
  return { ...(context ?? {}), id: request.id, requesterUserId: request.requesterUserId, taskId: request.taskId, agentId: request.agentId, tenant: request.tenant, skillId: request.skillId, kind: request.kind,
    status: request.status, title: request.title, summary: request.summary, risk: request.risk, policy: request.policy,
    assignedMembershipId: request.assignedMembershipId, currentRevision: request.currentRevision, expiresAt: request.expiresAt.toISOString(),
    createdAt: request.createdAt.toISOString(), updatedAt: request.updatedAt.toISOString() };
}
export const revisionView = (revision: DecisionRevisionRecord) => ({ id: revision.id, number: revision.number, action: revision.action,
  digest: revision.digest, authorType: revision.authorType, authorUserId: revision.authorUserId, createdAt: revision.createdAt.toISOString() });
export const decisionView = (decision: DecisionRecord) => ({ id: decision.id, requestId: decision.requestId, revisionId: decision.revisionId,
  revisionDigest: decision.revisionDigest, outcome: decision.outcome, rationale: decision.rationale, reviewerUserId: decision.reviewerUserId,
  reviewerMembershipId: decision.reviewerMembershipId, delegateMembershipId: decision.delegateMembershipId, createdAt: decision.createdAt.toISOString() });
export const executionView = (execution: DecisionExecutionRecord) => ({ id: execution.id, decisionId: execution.decisionId,
  revisionId: execution.revisionId, revisionDigest: execution.revisionDigest, commandId: execution.commandId, messageId: execution.messageId,
  status: execution.status, observedTaskState: execution.observedTaskState, observedAt: execution.observedAt?.toISOString() ?? null,
  error: execution.lastError, updatedAt: execution.updatedAt.toISOString() });

/** Visibility mirrors task access: administrators see all, others need a read grant for the request's agent/skill. */
export async function listDecisions(filter: { status?: DecisionRequestRecord["status"]; taskId?: string; mine?: boolean }, options: { orm?: MikroORM } = {}) {
  const principal = requirePrincipal();
  return withJobEntityManager(async (em) => {
    const policy = await requestAccessPolicy(em);
    const scope = !policy || policy.principal.role === "admin" ? undefined :
      policy.grants.map((grant) => ({ agentId: grant.agentId, skillId: grant.skillId }));
    const requests = await new MikroOrmDecisionRepository(em).listRequests(principal.organizationId,
      { status: filter.status, taskId: filter.taskId, assignedMembershipId: filter.mine ? principal.membershipId : undefined, scope }, 100);
    const context = await contextFor(em, principal.organizationId, requests);
    return requests.map((request) => requestView(request, context.get(request.id)));
  }, options.orm);
}

export async function readDecision(id: string, options: { orm?: MikroORM; store?: ArtifactStore } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return undefined;
  const principal = requirePrincipal();
  const unit = decisionUnitOfWork(options);
  const service = createDecisionService(options);
  const detail = await unit.run(async (p) => {
    const found = await loadDecisionDetail(p, principal.organizationId, id);
    if (!found) return undefined;
    // Same read ceiling as the task: no agent/skill read grant means the request does not exist for this user.
    const allowed = await p.canRead(principal, found.request.agentId, found.request.skillId);
    return allowed ? found : undefined;
  });
  if (!detail) return undefined;
  // Correlate each approved revision with its dispatch and observed task outcome on read.
  await Promise.all(detail.decisions.map((decision) => service.refreshExecution(principal.organizationId, decision.id)));
  const fresh = await unit.run((p) => loadDecisionDetail(p, principal.organizationId, id));
  if (!fresh) return undefined;
  const context = (await withJobEntityManager((em) => contextFor(em, principal.organizationId, [fresh.request]), options.orm)).get(fresh.request.id);
  return { ...fresh, context, people: await peopleFor(fresh, options.orm) };
}

/** Display names for the people named in a request, keyed by user ID and membership ID (same organization only). */
async function peopleFor(detail: { request: DecisionRequestRecord; revisions: DecisionRevisionRecord[]; decisions: DecisionRecord[] }, orm?: MikroORM) {
  const organizationId = detail.request.organizationId;
  const membershipIds = [...new Set([detail.request.assignedMembershipId, ...detail.decisions.flatMap((d) => [d.reviewerMembershipId, d.delegateMembershipId])]
    .filter((id): id is string => Boolean(id)))];
  return withJobEntityManager(async (em) => {
    const memberships = membershipIds.length ? await em.find(MembershipEntity, { organizationId, id: { $in: membershipIds } }) : [];
    const userIds = [...new Set([detail.request.requesterUserId, ...detail.revisions.map((r) => r.authorUserId), ...detail.decisions.map((d) => d.reviewerUserId),
      ...memberships.map((m) => m.userId)].filter((id): id is string => Boolean(id)))];
    const users = userIds.length ? await em.find(UserEntity, { id: { $in: userIds } }) : [];
    const memberUserIds = new Set((await em.find(MembershipEntity, { organizationId, userId: { $in: userIds } })).map((m) => m.userId));
    const name = new Map(users.filter((user) => memberUserIds.has(user.id)).map((user) => [user.id, user.displayName]));
    const people: Record<string, string> = Object.fromEntries(name);
    for (const membership of memberships) { const label = name.get(membership.userId); if (label) people[membership.id] = label; }
    return people;
  }, orm);
}

/** Enabled operator-capable members who could review this task's agent/skill, for assignment and delegation. */
export async function listEligibleReviewers(taskId: string, options: { orm?: MikroORM } = {}) {
  const principal = requirePrincipal();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId)) return undefined;
  return withJobEntityManager(async (em) => {
    const p = ports(em);
    const task = await p.tasks.findById(principal.organizationId, taskId);
    if (!task) return undefined;
    const members = await em.find(MembershipEntity, { organizationId: principal.organizationId, enabled: true, role: { $in: ["admin", "operator"] } }, { refresh: true });
    const users = members.length ? await em.find(UserEntity, { id: { $in: members.map((member) => member.userId) }, enabled: true }) : [];
    const eligible = [];
    for (const member of members) {
      const user = users.find((candidate) => candidate.id === member.userId);
      if (user && await p.canOperate(principal.organizationId, member.id, task.agentId, task.skillId ?? null))
        eligible.push({ membershipId: member.id, displayName: user.displayName, role: member.role, self: member.id === principal.membershipId });
    }
    return eligible.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, options.orm);
}

export function detailView(detail: NonNullable<Awaited<ReturnType<typeof readDecision>>>) {
  return { request: requestView(detail.request, detail.context), revisions: detail.revisions.map(revisionView),
    decisions: detail.decisions.map(decisionView), executions: detail.executions.map(executionView), people: detail.people,
    viewer: (({ userId, membershipId, role }) => ({ userId, membershipId, role }))(requirePrincipal()) };
}
