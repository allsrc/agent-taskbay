import { LockMode, type EntityManager } from "@mikro-orm/core";
import type { DecisionRepository, DecisionRequestFilter } from "../../application/ports/decisions";
import type {
  DecisionExecutionRecord, DecisionRecord, DecisionRequestRecord, DecisionRevisionRecord,
} from "../../domain/decision-model";
import { DecisionEntity, DecisionExecutionEntity, DecisionRequestEntity, DecisionRevisionEntity } from "./entities";

function requestRecord(entity: DecisionRequestEntity): DecisionRequestRecord {
  return { id: entity.id, organizationId: entity.organizationId, taskId: entity.taskId, agentId: entity.agentId, tenant: entity.tenant,
    skillId: entity.skillId ?? null, kind: entity.kind, status: entity.status, requestKey: entity.requestKey, title: entity.title,
    summary: entity.summary, risk: entity.risk, policy: entity.policyJson, requesterUserId: entity.requesterUserId ?? null,
    assignedMembershipId: entity.assignedMembershipId ?? null, currentRevision: entity.currentRevision, expiresAt: entity.expiresAt,
    createdAt: entity.createdAt, updatedAt: entity.updatedAt, version: entity.version };
}
function revisionRecord(entity: DecisionRevisionEntity): DecisionRevisionRecord {
  return { id: entity.id, organizationId: entity.organizationId, requestId: entity.requestId, number: entity.number, action: entity.actionJson,
    digest: entity.digest, authorType: entity.authorType, authorUserId: entity.authorUserId ?? null, createdAt: entity.createdAt };
}
function decisionRecord(entity: DecisionEntity): DecisionRecord {
  return { id: entity.id, organizationId: entity.organizationId, requestId: entity.requestId, revisionId: entity.revisionId,
    revisionDigest: entity.revisionDigest, outcome: entity.outcome, rationale: entity.rationale, reviewerUserId: entity.reviewerUserId,
    reviewerMembershipId: entity.reviewerMembershipId, delegateMembershipId: entity.delegateMembershipId ?? null,
    idempotencyKey: entity.idempotencyKey, inputDigest: entity.inputDigest, policy: entity.policyJson, createdAt: entity.createdAt };
}
function executionRecord(entity: DecisionExecutionEntity): DecisionExecutionRecord {
  return { id: entity.id, organizationId: entity.organizationId, decisionId: entity.decisionId, revisionId: entity.revisionId,
    revisionDigest: entity.revisionDigest, commandId: entity.commandId, messageId: entity.messageId, status: entity.status,
    observedTaskState: entity.observedTaskState ?? null, observedAt: entity.observedAt ?? null, lastError: entity.lastError ?? null,
    createdAt: entity.createdAt, updatedAt: entity.updatedAt };
}

const ACTIVE = ["pending", "changes_requested"];
const TERMINAL_TASK_STATES = ["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"];

export class MikroOrmDecisionRepository implements DecisionRepository {
  constructor(private readonly em: EntityManager) {}

  async lockRequest(organizationId: string, id: string) {
    const entity = await this.em.findOne(DecisionRequestEntity, { id, organizationId }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
    return entity ? requestRecord(entity) : undefined;
  }
  async findRequest(organizationId: string, id: string) {
    const entity = await this.em.findOne(DecisionRequestEntity, { id, organizationId }, { refresh: true });
    return entity ? requestRecord(entity) : undefined;
  }
  async insertRequest(request: DecisionRequestRecord, firstRevision: DecisionRevisionRecord) {
    // The unique key arbitrates concurrent opens; the loser reads the winner's committed row.
    const inserted = await this.em.getConnection().execute(
      `insert into decision_requests (id, organization_id, task_id, agent_id, tenant, skill_id, kind, status, request_key, title, summary, risk,
        policy_json, requester_user_id, assigned_membership_id, current_revision, expires_at, created_at, updated_at, version)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, 1) on conflict (organization_id, request_key) do nothing returning id`,
      [request.id, request.organizationId, request.taskId, request.agentId, request.tenant, request.skillId, request.kind, request.status,
        request.requestKey, request.title, request.summary, request.risk, JSON.stringify(request.policy), request.requesterUserId,
        request.assignedMembershipId, request.currentRevision, request.expiresAt, request.createdAt, request.updatedAt],
      "all", this.em.getTransactionContext());
    if (inserted.length) {
      this.em.create(DecisionRevisionEntity, { id: firstRevision.id, organizationId: firstRevision.organizationId, requestId: firstRevision.requestId,
        number: firstRevision.number, actionJson: firstRevision.action, digest: firstRevision.digest, authorType: firstRevision.authorType,
        authorUserId: firstRevision.authorUserId, createdAt: firstRevision.createdAt });
      await this.em.flush();
    }
    const stored = await this.em.findOneOrFail(DecisionRequestEntity, { organizationId: request.organizationId, requestKey: request.requestKey }, { refresh: true });
    return { request: requestRecord(stored), created: inserted.length > 0 };
  }
  async updateRequest(request: DecisionRequestRecord) {
    const entity = await this.em.findOneOrFail(DecisionRequestEntity, { id: request.id, organizationId: request.organizationId });
    entity.status = request.status; entity.assignedMembershipId = request.assignedMembershipId;
    entity.currentRevision = request.currentRevision; entity.updatedAt = request.updatedAt;
    await this.em.flush();
    return requestRecord(entity);
  }
  async listRequests(organizationId: string, filter: DecisionRequestFilter, limit: number) {
    const entities = await this.em.find(DecisionRequestEntity, { organizationId,
      ...(filter.status ? { status: filter.status } : {}), ...(filter.taskId ? { taskId: filter.taskId } : {}),
      ...(filter.assignedMembershipId ? { assignedMembershipId: filter.assignedMembershipId } : {}),
      ...(filter.scope ? (filter.scope.length ? { $or: filter.scope.map((grant) => ({ agentId: grant.agentId,
        ...(grant.skillId !== null ? { skillId: grant.skillId } : {}) })) } : { id: { $in: [] } }) : {}) },
    { orderBy: { createdAt: "desc", id: "asc" }, limit, refresh: true });
    return entities.map(requestRecord);
  }
  async lockActiveForTask(organizationId: string, taskId: string) {
    const entities = await this.em.find(DecisionRequestEntity, { organizationId, taskId, status: { $in: ACTIVE as never[] } },
      { orderBy: { id: "asc" }, lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
    return entities.map(requestRecord);
  }
  async dueForExpiry(now: Date, limit: number) {
    const entities = await this.em.find(DecisionRequestEntity, { status: { $in: ACTIVE as never[] }, expiresAt: { $lte: now } },
      { orderBy: { expiresAt: "asc" }, limit, refresh: true });
    return entities.map(requestRecord);
  }
  async forFinishedTasks(limit: number) {
    const ids = await this.em.getConnection().execute(
      `select r.id from decision_requests r join tasks t on t.id = r.task_id
       where r.status in ('pending', 'changes_requested') and (t.terminal_at is not null
         or t.state in ('TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED'))
       order by r.updated_at asc limit ?`, [limit], "all", this.em.getTransactionContext()) as Array<{ id: string }>;
    if (!ids.length) return [];
    return (await this.em.find(DecisionRequestEntity, { id: { $in: ids.map((row) => row.id) } }, { orderBy: { updatedAt: "asc" }, refresh: true })).map(requestRecord);
  }
  async unsettledExecutions(since: Date, limit: number) {
    const entities = await this.em.find(DecisionExecutionEntity, { createdAt: { $gte: since }, $or: [
      { status: { $in: ["pending", "dispatching"] as never[] } },
      { status: "succeeded", $or: [{ observedTaskState: null }, { observedTaskState: { $nin: TERMINAL_TASK_STATES } }] }] },
    { orderBy: { updatedAt: "asc" }, limit, refresh: true });
    return entities.map(executionRecord);
  }
  async decisionById(organizationId: string, id: string) {
    const entity = await this.em.findOne(DecisionEntity, { organizationId, id }, { refresh: true });
    return entity ? decisionRecord(entity) : undefined;
  }
  async revisions(organizationId: string, requestId: string) {
    return (await this.em.find(DecisionRevisionEntity, { organizationId, requestId }, { orderBy: { number: "asc" }, refresh: true })).map(revisionRecord);
  }
  async appendRevision(revision: DecisionRevisionRecord) {
    this.em.create(DecisionRevisionEntity, { id: revision.id, organizationId: revision.organizationId, requestId: revision.requestId,
      number: revision.number, actionJson: revision.action, digest: revision.digest, authorType: revision.authorType,
      authorUserId: revision.authorUserId, createdAt: revision.createdAt });
    await this.em.flush();
    return revision;
  }
  async decisions(organizationId: string, requestId: string) {
    return (await this.em.find(DecisionEntity, { organizationId, requestId }, { orderBy: { createdAt: "asc", id: "asc" }, refresh: true })).map(decisionRecord);
  }
  async findDecisionByKey(organizationId: string, idempotencyKey: string) {
    const entity = await this.em.findOne(DecisionEntity, { organizationId, idempotencyKey }, { refresh: true });
    return entity ? decisionRecord(entity) : undefined;
  }
  async insertDecision(decision: DecisionRecord) {
    this.em.create(DecisionEntity, { id: decision.id, organizationId: decision.organizationId, requestId: decision.requestId,
      revisionId: decision.revisionId, revisionDigest: decision.revisionDigest, outcome: decision.outcome, rationale: decision.rationale,
      reviewerUserId: decision.reviewerUserId, reviewerMembershipId: decision.reviewerMembershipId,
      delegateMembershipId: decision.delegateMembershipId, idempotencyKey: decision.idempotencyKey, inputDigest: decision.inputDigest,
      policyJson: decision.policy, createdAt: decision.createdAt });
    await this.em.flush();
    return decision;
  }
  async insertExecution(execution: DecisionExecutionRecord) {
    this.em.create(DecisionExecutionEntity, { ...execution });
    await this.em.flush();
    return execution;
  }
  async findExecutionByDecision(organizationId: string, decisionId: string) {
    const entity = await this.em.findOne(DecisionExecutionEntity, { organizationId, decisionId }, { refresh: true });
    return entity ? executionRecord(entity) : undefined;
  }
  async updateExecution(execution: DecisionExecutionRecord) {
    const entity = await this.em.findOneOrFail(DecisionExecutionEntity, { id: execution.id, organizationId: execution.organizationId });
    entity.status = execution.status; entity.observedTaskState = execution.observedTaskState; entity.observedAt = execution.observedAt;
    entity.lastError = execution.lastError; entity.updatedAt = execution.updatedAt;
    await this.em.flush();
    return executionRecord(entity);
  }
}
