import type { MikroORM } from "@mikro-orm/core";
import { z } from "zod";
import { withJobEntityManager } from "../adapters/db/orm";
import { createPersistenceRepositories } from "../adapters/db/repositories";
import { MikroOrmDecisionRepository } from "../adapters/db/decision-repository";
import { DatabaseIdentityRepository } from "../adapters/db/identity-repository";
import { DatabaseAccessPolicyRepository, requestAccessPolicy } from "../adapters/db/security-repository";
import { MembershipEntity, UserEntity } from "../adapters/db/entities";
import { currentPrincipal } from "../adapters/auth/principal-context";
import { AccessPolicy } from "../application/services/access-policy";
import { AuthenticationError } from "../application/services/authorization";
import { DecisionError, DecisionService, loadDecisionDetail } from "../application/services/decisions";
import type { DecisionPorts, DecisionUnitOfWork } from "../application/ports/decisions";
import type { Principal } from "../application/ports/identity";
import type { ProposedAction, DecisionExecutionRecord, DecisionRecord, DecisionRequestRecord, DecisionRevisionRecord } from "../domain/decision-model";
import type { ArtifactStore } from "../application/ports/artifact-store";
import type { JsonValue } from "../domain/persistence-model";
import { acceptCommandWithin } from "./commands";

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
  const base = createPersistenceRepositories(em);
  const identity = new DatabaseIdentityRepository(em);
  return {
    decisions: new MikroOrmDecisionRepository(em), tasks: base.tasks, commands: base.commands,
    requireOperate: async (principal, agentId, skillId) => {
      const policy = await requestAccessPolicy(em);
      (policy ?? new AccessPolicy(principal, [])).require(agentId, "operate", skillId);
    },
    canRead: async (principal, agentId, skillId) => {
      const policy = await requestAccessPolicy(em);
      return (policy ?? new AccessPolicy(principal, [])).allows(agentId, "read", skillId);
    },
    canOperate: async (organizationId, membershipId, agentId, skillId) => {
      const membership = await em.findOne(MembershipEntity, { id: membershipId, organizationId, enabled: true }, { refresh: true });
      const user = membership && await em.findOne(UserEntity, { id: membership.userId, enabled: true }, { refresh: true });
      if (!membership || !user || !["admin", "operator"].includes(membership.role)) return false;
      const principal: Principal = { userId: user.id, organizationId, membershipId, displayName: user.displayName, role: membership.role as Principal["role"] };
      return new AccessPolicy(principal, await new DatabaseAccessPolicyRepository(em).grantsFor(principal)).allows(agentId, "operate", skillId);
    },
    acceptCommand: (input) => acceptCommandWithin(em, { organizationId: input.organizationId, agentId: input.agentId, tenant: input.tenant,
      action: "send", skillId: input.skillId ?? undefined, idempotencyKey: input.idempotencyKey, store,
      input: { text: input.text, taskId: input.taskRemoteId, ...(input.contextId ? { contextId: input.contextId } : {}), messageId: input.messageId },
      params: JSON.parse(JSON.stringify({ text: input.text, taskId: input.taskRemoteId, messageId: input.messageId, returnImmediately: true,
        ...(input.contextId ? { contextId: input.contextId } : {}), ...(input.data ? { metadata: { decision: input.data } } : {}) })) as Record<string, JsonValue> }),
    audit: async (principal, organizationId, action, targetId, eventKey) => {
      if (principal) await identity.appendAudit(principal, action, targetId, eventKey);
      else await identity.appendSystemAudit(organizationId, action, targetId);
    },
  };
}

export function decisionUnitOfWork(options: { orm?: MikroORM; store?: ArtifactStore } = {}): DecisionUnitOfWork {
  return { run: (work) => withJobEntityManager((em) => em.transactional((transaction) => work(ports(transaction, options.store))), options.orm) };
}
export const createDecisionService = (options: { orm?: MikroORM; store?: ArtifactStore } = {}) => new DecisionService(decisionUnitOfWork(options));

export function requestView(request: DecisionRequestRecord) {
  return { id: request.id, taskId: request.taskId, agentId: request.agentId, tenant: request.tenant, skillId: request.skillId, kind: request.kind,
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
    return requests.map(requestView);
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
  return unit.run((p) => loadDecisionDetail(p, principal.organizationId, id));
}

export function detailView(detail: NonNullable<Awaited<ReturnType<typeof readDecision>>>) {
  return { request: requestView(detail.request), revisions: detail.revisions.map(revisionView),
    decisions: detail.decisions.map(decisionView), executions: detail.executions.map(executionView) };
}
