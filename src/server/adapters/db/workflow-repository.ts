import { randomUUID } from "node:crypto";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import type { WorkflowFilter, WorkflowRepository } from "../../application/ports/workflow";
import type { AssignmentEventRecord, EscalationPolicyRecord, TaskAssignmentRecord, TaskNoteRecord } from "../../domain/workflow-model";
import { EscalationPolicyEntity, TaskAssignmentEntity, TaskAssignmentEventEntity, TaskNoteEntity } from "./entities";

const TERMINAL_SQL = "('TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED')";

function assignmentRecord(entity: TaskAssignmentEntity): TaskAssignmentRecord {
  return { id: entity.id, organizationId: entity.organizationId, taskId: entity.taskId, assigneeMembershipId: entity.assigneeMembershipId ?? null,
    claimedAt: entity.claimedAt ?? null, dueAt: entity.dueAt ?? null, escalationLevel: entity.escalationLevel, escalatedAt: entity.escalatedAt ?? null,
    updatedAt: entity.updatedAt, version: entity.version };
}
const eventRecord = (entity: TaskAssignmentEventEntity): AssignmentEventRecord => ({ id: entity.id, organizationId: entity.organizationId, taskId: entity.taskId,
  kind: entity.kind, actorUserId: entity.actorUserId ?? null, fromMembershipId: entity.fromMembershipId ?? null, toMembershipId: entity.toMembershipId ?? null,
  dueAt: entity.dueAt ?? null, createdAt: entity.createdAt });
const noteRecord = (entity: TaskNoteEntity): TaskNoteRecord => ({ id: entity.id, organizationId: entity.organizationId, taskId: entity.taskId,
  noteKey: entity.noteKey, authorUserId: entity.authorUserId, body: entity.body, createdAt: entity.createdAt });
const policyRecord = (entity: EscalationPolicyEntity): EscalationPolicyRecord => ({ id: entity.id, organizationId: entity.organizationId,
  agentId: entity.agentId ?? null, targetMembershipId: entity.targetMembershipId, enabled: entity.enabled, createdAt: entity.createdAt, updatedAt: entity.updatedAt });

export class MikroOrmWorkflowRepository implements WorkflowRepository {
  constructor(private readonly em: EntityManager) {}

  async lockAssignment(organizationId: string, taskId: string, now: Date) {
    // The unique task key arbitrates concurrent first assignments; everyone then locks the same row.
    await this.em.getConnection().execute(
      `insert into task_assignments (id, organization_id, task_id, escalation_level, updated_at, version) values (?, ?, ?, 0, ?, 1)
       on conflict (task_id) do nothing`, [randomUUID(), organizationId, taskId, now], "all", this.em.getTransactionContext());
    const entity = await this.em.findOneOrFail(TaskAssignmentEntity, { organizationId, taskId }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
    return assignmentRecord(entity);
  }
  async findAssignment(organizationId: string, taskId: string) {
    const entity = await this.em.findOne(TaskAssignmentEntity, { organizationId, taskId }, { refresh: true });
    return entity ? assignmentRecord(entity) : undefined;
  }
  async saveAssignment(assignment: TaskAssignmentRecord) {
    const entity = await this.em.findOneOrFail(TaskAssignmentEntity, { id: assignment.id, organizationId: assignment.organizationId });
    entity.assigneeMembershipId = assignment.assigneeMembershipId; entity.claimedAt = assignment.claimedAt; entity.dueAt = assignment.dueAt;
    entity.escalationLevel = assignment.escalationLevel; entity.escalatedAt = assignment.escalatedAt; entity.updatedAt = assignment.updatedAt;
    await this.em.flush();
    return assignmentRecord(entity);
  }
  async assignmentsFor(organizationId: string, taskIds: string[]) {
    if (!taskIds.length) return [];
    return (await this.em.find(TaskAssignmentEntity, { organizationId, taskId: { $in: taskIds } }, { refresh: true })).map(assignmentRecord);
  }
  async taskIdsFor(organizationId: string, filter: WorkflowFilter, membershipId: string, now: Date) {
    const rows = await this.em.getConnection().execute(
      filter === "mine" ? `select a.task_id as id from task_assignments a where a.organization_id = ? and a.assignee_membership_id = ?` :
        filter === "overdue" ? `select a.task_id as id from task_assignments a join tasks t on t.id = a.task_id
          where a.organization_id = ? and a.due_at <= ? and t.terminal_at is null and t.state not in ${TERMINAL_SQL}` :
          `select a.task_id as id from task_assignments a where a.organization_id = ? and a.assignee_membership_id is not null`,
      filter === "mine" ? [organizationId, membershipId] : filter === "overdue" ? [organizationId, now] : [organizationId],
      "all", this.em.getTransactionContext()) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }
  async appendEvent(event: AssignmentEventRecord) {
    this.em.create(TaskAssignmentEventEntity, { ...event });
    await this.em.flush();
    return event;
  }
  async events(organizationId: string, taskId: string, limit: number) {
    return (await this.em.find(TaskAssignmentEventEntity, { organizationId, taskId }, { orderBy: { createdAt: "desc", id: "desc" }, limit, refresh: true })).map(eventRecord);
  }
  async insertNote(note: TaskNoteRecord) {
    const inserted = await this.em.getConnection().execute(
      `insert into task_notes (id, organization_id, task_id, note_key, author_user_id, body, created_at) values (?, ?, ?, ?, ?, ?, ?)
       on conflict (organization_id, note_key) do nothing returning id`,
      [note.id, note.organizationId, note.taskId, note.noteKey, note.authorUserId, note.body, note.createdAt], "all", this.em.getTransactionContext());
    const stored = await this.em.findOneOrFail(TaskNoteEntity, { organizationId: note.organizationId, noteKey: note.noteKey }, { refresh: true });
    return { note: noteRecord(stored), created: inserted.length > 0 };
  }
  async notes(organizationId: string, taskId: string, limit: number) {
    return (await this.em.find(TaskNoteEntity, { organizationId, taskId }, { orderBy: { createdAt: "desc", id: "desc" }, limit, refresh: true })).map(noteRecord);
  }
  async dueForEscalation(now: Date, limit: number) {
    const rows = await this.em.getConnection().execute(
      `select a.id from task_assignments a join tasks t on t.id = a.task_id
       where a.due_at <= ? and a.escalated_at is null and t.terminal_at is null and t.state not in ${TERMINAL_SQL}
       order by a.due_at asc limit ?`, [now, limit], "all", this.em.getTransactionContext()) as Array<{ id: string }>;
    if (!rows.length) return [];
    return (await this.em.find(TaskAssignmentEntity, { id: { $in: rows.map((row) => row.id) } }, { orderBy: { dueAt: "asc" }, refresh: true })).map(assignmentRecord);
  }
  async policies(organizationId: string) {
    return (await this.em.find(EscalationPolicyEntity, { organizationId }, { orderBy: { createdAt: "asc", id: "asc" }, refresh: true })).map(policyRecord);
  }
  async findPolicy(organizationId: string, agentId: string | null) {
    // Serializes concurrent edits of one scope (an organization-wide scope has no row to lock until it exists).
    await this.em.getConnection().execute("select pg_advisory_xact_lock(hashtext(?))", [`escalation:${organizationId}:${agentId ?? ""}`], "all", this.em.getTransactionContext());
    const entity = await this.em.findOne(EscalationPolicyEntity, { organizationId, agentId }, { refresh: true });
    return entity ? policyRecord(entity) : undefined;
  }
  async policyFor(organizationId: string, agentId: string) {
    const specific = await this.em.findOne(EscalationPolicyEntity, { organizationId, agentId, enabled: true }, { refresh: true });
    const entity = specific ?? await this.em.findOne(EscalationPolicyEntity, { organizationId, agentId: null, enabled: true }, { refresh: true });
    return entity ? policyRecord(entity) : undefined;
  }
  async savePolicy(policy: EscalationPolicyRecord) {
    const existing = await this.em.findOne(EscalationPolicyEntity, { id: policy.id, organizationId: policy.organizationId });
    if (existing) { existing.targetMembershipId = policy.targetMembershipId; existing.enabled = policy.enabled; existing.updatedAt = policy.updatedAt; await this.em.flush(); return policyRecord(existing); }
    const created = this.em.create(EscalationPolicyEntity, { ...policy });
    await this.em.flush();
    return policyRecord(created);
  }
}
