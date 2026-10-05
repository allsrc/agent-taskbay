import { randomUUID } from "node:crypto";
import type { AssignmentEventKind, AssignmentEventRecord, EscalationPolicyRecord, TaskAssignmentRecord, TaskNoteRecord } from "../../domain/workflow-model";
import type { Principal } from "../ports/identity";
import type { WorkflowPorts, WorkflowUnitOfWork } from "../ports/workflow";
import type { Clock } from "../ports/clock";
import type { TaskRecord } from "../../domain/persistence-model";
import { authorize } from "./authorization";

export class WorkflowError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
const TERMINAL_STATES = ["COMPLETED", "FAILED", "CANCELED", "REJECTED"];
const MAX_DUE_MS = 365 * 24 * 60 * 60 * 1000;
export const MAX_NOTE_LENGTH = 4000;

const finished = (task: Pick<TaskRecord, "state" | "terminalAt">) => task.terminalAt !== null || TERMINAL_STATES.includes(task.state.replace("TASK_STATE_", ""));

/** Assignment, claiming, due times, escalation and internal notes: all independent of the remote A2A task state. */
export class TaskWorkflowService {
  constructor(private readonly work: WorkflowUnitOfWork, private readonly clock: Clock = { now: () => new Date() }) {}

  /** Only existing assignees (and administrators) may change owned work; anyone with access may take unowned work. */
  private canManage(principal: Principal, assignment: TaskAssignmentRecord) {
    return principal.role === "admin" || assignment.assigneeMembershipId === null || assignment.assigneeMembershipId === principal.membershipId;
  }

  /**
   * Timestamps for history rows within one task strictly increase, so ordering never depends on a clock tie.
   * The locked assignment's updatedAt is the time of its latest event.
   */
  private next(assignment: TaskAssignmentRecord) {
    const now = this.clock.now();
    return now > assignment.updatedAt ? now : new Date(assignment.updatedAt.getTime() + 1);
  }

  private async record(ports: WorkflowPorts, principal: Principal | null, task: TaskRecord, kind: AssignmentEventKind, detail: Partial<AssignmentEventRecord>) {
    const event: AssignmentEventRecord = { id: randomUUID(), organizationId: task.organizationId, taskId: task.id, kind, actorUserId: principal?.userId ?? null,
      fromMembershipId: null, toMembershipId: null, dueAt: null, createdAt: this.clock.now(), ...detail };
    await ports.workflow.appendEvent(event);
    await ports.audit(principal, task.organizationId, `task.${kind}`, task.id, `task-workflow:${event.id}`);
    await ports.freshen(task.organizationId, task.id);
  }

  private async scoped(ports: WorkflowPorts, principal: Principal, taskId: string, options: { open?: boolean } = {}) {
    authorize(principal, "operate");
    const task = await ports.tasks.findById(principal.organizationId, taskId);
    if (!task) throw new WorkflowError("Task not found.", 404);
    if (task.kind !== "task") throw new WorkflowError("Only A2A tasks can be assigned.", 409);
    await ports.requireOperate(principal, task.agentId, task.skillId ?? null);
    if (options.open && finished(task)) throw new WorkflowError("The task is already finished.", 409);
    return task;
  }

  async claim(principal: Principal, taskId: string) {
    return this.work.run(async (ports) => {
      const task = await this.scoped(ports, principal, taskId, { open: true });
      const now = this.clock.now();
      const assignment = await ports.workflow.lockAssignment(task.organizationId, task.id, now);
      if (assignment.assigneeMembershipId === principal.membershipId) return assignment;
      if (assignment.assigneeMembershipId) throw new WorkflowError("This task is already owned by someone else.", 409);
      const at = this.next(assignment);
      const saved = await ports.workflow.saveAssignment({ ...assignment, assigneeMembershipId: principal.membershipId, claimedAt: at, updatedAt: at });
      await this.record(ports, principal, task, "claimed", { toMembershipId: principal.membershipId, createdAt: at });
      return saved;
    });
  }

  async release(principal: Principal, taskId: string) {
    return this.work.run(async (ports) => {
      const task = await this.scoped(ports, principal, taskId);
      const now = this.clock.now();
      const assignment = await ports.workflow.lockAssignment(task.organizationId, task.id, now);
      if (!assignment.assigneeMembershipId) return assignment;
      if (!this.canManage(principal, assignment)) throw new WorkflowError("Only the owner or an administrator can release this task.", 403);
      const at = this.next(assignment);
      const saved = await ports.workflow.saveAssignment({ ...assignment, assigneeMembershipId: null, claimedAt: null, updatedAt: at });
      await this.record(ports, principal, task, "released", { fromMembershipId: assignment.assigneeMembershipId, createdAt: at });
      return saved;
    });
  }

  async assign(principal: Principal, taskId: string, assigneeMembershipId: string) {
    return this.work.run(async (ports) => {
      const task = await this.scoped(ports, principal, taskId, { open: true });
      const now = this.clock.now();
      const assignment = await ports.workflow.lockAssignment(task.organizationId, task.id, now);
      if (assignment.assigneeMembershipId === assigneeMembershipId) return assignment;
      if (!this.canManage(principal, assignment)) throw new WorkflowError("Only the owner or an administrator can reassign this task.", 403);
      if (!await ports.canOperate(task.organizationId, assigneeMembershipId, task.agentId, task.skillId ?? null))
        throw new WorkflowError("The assignee cannot operate this agent.", 422);
      const at = this.next(assignment);
      const saved = await ports.workflow.saveAssignment({ ...assignment, assigneeMembershipId, claimedAt: assigneeMembershipId === principal.membershipId ? at : null, updatedAt: at });
      await this.record(ports, principal, task, "assigned", { fromMembershipId: assignment.assigneeMembershipId, toMembershipId: assigneeMembershipId, createdAt: at });
      return saved;
    });
  }

  /** Sets or clears the due time. A new due time re-arms escalation. */
  async setDue(principal: Principal, taskId: string, dueAt: Date | null) {
    const now = this.clock.now();
    if (dueAt && (Number.isNaN(dueAt.getTime()) || dueAt <= now || dueAt.getTime() - now.getTime() > MAX_DUE_MS))
      throw new WorkflowError("The due time must be in the future and within a year.", 400);
    return this.work.run(async (ports) => {
      const task = await this.scoped(ports, principal, taskId, { open: true });
      const assignment = await ports.workflow.lockAssignment(task.organizationId, task.id, now);
      if (!this.canManage(principal, assignment)) throw new WorkflowError("Only the owner or an administrator can change the due time.", 403);
      if ((assignment.dueAt?.getTime() ?? null) === (dueAt?.getTime() ?? null)) return assignment;
      const at = this.next(assignment);
      const saved = await ports.workflow.saveAssignment({ ...assignment, dueAt, escalatedAt: null, updatedAt: at });
      await this.record(ports, principal, task, dueAt ? "due_set" : "due_cleared", { dueAt, fromMembershipId: assignment.assigneeMembershipId, createdAt: at });
      return saved;
    });
  }

  async addNote(principal: Principal, taskId: string, input: { body: string; noteKey: string }) {
    const body = input.body?.trim() ?? "";
    if (!body || body.length > MAX_NOTE_LENGTH) throw new WorkflowError(`A note needs 1–${MAX_NOTE_LENGTH} characters.`, 400);
    if (!input.noteKey || input.noteKey.length > 255) throw new WorkflowError("A note key of 1–255 characters is required.", 400);
    return this.work.run(async (ports) => {
      const task = await this.scoped(ports, principal, taskId);
      const result = await ports.workflow.insertNote({ id: randomUUID(), organizationId: task.organizationId, taskId: task.id, noteKey: input.noteKey,
        authorUserId: principal.userId, body, createdAt: this.clock.now() });
      if (!result.created) {
        // A repeated submit must be the same note on the same task by the same author.
        if (result.note.taskId !== task.id || result.note.authorUserId !== principal.userId || result.note.body !== body)
          throw new WorkflowError("This note key already belongs to a different note.", 409);
        return result.note;
      }
      await ports.audit(principal, task.organizationId, "task.note_added", task.id, `task-note:${result.note.id}`);
      await ports.freshen(task.organizationId, task.id);
      return result.note;
    });
  }

  /** Administrator-managed escalation target for one agent, or for every agent when agentId is null. */
  async setPolicy(principal: Principal, input: { agentId: string | null; targetMembershipId: string; enabled: boolean }) {
    authorize(principal, "administer");
    return this.work.run(async (ports) => {
      if (!await ports.isReviewer(principal.organizationId, input.targetMembershipId)) throw new WorkflowError("The escalation target must be an active operator or administrator.", 422);
      const now = this.clock.now();
      const existing = await ports.workflow.findPolicy(principal.organizationId, input.agentId);
      const policy: EscalationPolicyRecord = existing ? { ...existing, targetMembershipId: input.targetMembershipId, enabled: input.enabled, updatedAt: now } :
        { id: randomUUID(), organizationId: principal.organizationId, agentId: input.agentId, targetMembershipId: input.targetMembershipId, enabled: input.enabled, createdAt: now, updatedAt: now };
      const saved = await ports.workflow.savePolicy(policy);
      await ports.audit(principal, principal.organizationId, "escalation.policy_saved", saved.id, `escalation-policy:${saved.id}:${now.getTime()}`);
      return saved;
    });
  }

  /**
   * Escalates unfinished tasks whose due time passed: hands them to the policy's target and records why. With no
   * enabled policy nothing happens (the task still shows as overdue). Each due time escalates at most once.
   */
  async sweepEscalations(limit = 100) {
    const now = this.clock.now();
    return this.work.run(async (ports) => {
      let escalated = 0;
      for (const candidate of await ports.workflow.dueForEscalation(now, limit)) {
        const assignment = await ports.workflow.lockAssignment(candidate.organizationId, candidate.taskId, now);
        if (!assignment.dueAt || assignment.dueAt > now || assignment.escalatedAt) continue;
        const task = await ports.tasks.findById(assignment.organizationId, assignment.taskId);
        if (!task || finished(task)) continue;
        const policy = await ports.workflow.policyFor(assignment.organizationId, task.agentId);
        if (!policy) continue;
        const eligible = await ports.canOperate(assignment.organizationId, policy.targetMembershipId, task.agentId, task.skillId ?? null);
        const next = eligible ? policy.targetMembershipId : assignment.assigneeMembershipId;
        const at = this.next(assignment);
        await ports.workflow.saveAssignment({ ...assignment, assigneeMembershipId: next, claimedAt: next === assignment.assigneeMembershipId ? assignment.claimedAt : null,
          escalationLevel: assignment.escalationLevel + 1, escalatedAt: at, updatedAt: at });
        // toMembershipId is null when the target could no longer operate the agent, so the owner kept the task.
        await this.record(ports, null, task, "escalated", { fromMembershipId: assignment.assigneeMembershipId, toMembershipId: eligible ? policy.targetMembershipId : null, dueAt: assignment.dueAt, createdAt: at });
        escalated += 1;
      }
      return escalated;
    });
  }

  async detail(principal: Principal, taskId: string) {
    return this.work.run(async (ports) => {
      const task = await ports.tasks.findById(principal.organizationId, taskId);
      if (!task || task.kind !== "task") return undefined;
      const [assignment, events, notes] = await Promise.all([ports.workflow.findAssignment(task.organizationId, task.id),
        ports.workflow.events(task.organizationId, task.id, 50), ports.workflow.notes(task.organizationId, task.id, 100)]);
      const people = await ports.names(task.organizationId,
        [...events.map((event) => event.actorUserId), ...notes.map((note) => note.authorUserId)].filter((id): id is string => Boolean(id)),
        [assignment?.assigneeMembershipId, ...events.flatMap((event) => [event.fromMembershipId, event.toMembershipId])].filter((id): id is string => Boolean(id)));
      return { task, assignment: assignment ?? null, events, notes, people };
    });
  }
}
export type { TaskNoteRecord };
