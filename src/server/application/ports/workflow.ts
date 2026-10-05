import type { AssignmentEventRecord, EscalationPolicyRecord, TaskAssignmentRecord, TaskNoteRecord } from "../../domain/workflow-model";
import type { TaskRecord } from "../../domain/persistence-model";
import type { Principal } from "./identity";

export type WorkflowFilter = "mine" | "overdue" | "unassigned";

export interface WorkflowRepository {
  /** Creates the empty assignment row if absent, then locks it for the rest of the transaction. */
  lockAssignment(organizationId: string, taskId: string, now: Date): Promise<TaskAssignmentRecord>;
  findAssignment(organizationId: string, taskId: string): Promise<TaskAssignmentRecord | undefined>;
  saveAssignment(assignment: TaskAssignmentRecord): Promise<TaskAssignmentRecord>;
  assignmentsFor(organizationId: string, taskIds: string[]): Promise<TaskAssignmentRecord[]>;
  /** Task IDs matching a workflow view; unassigned returns the assigned IDs to exclude instead. */
  taskIdsFor(organizationId: string, filter: WorkflowFilter, membershipId: string, now: Date): Promise<string[]>;
  appendEvent(event: AssignmentEventRecord): Promise<AssignmentEventRecord>;
  events(organizationId: string, taskId: string, limit: number): Promise<AssignmentEventRecord[]>;
  /** Idempotent on (organization, noteKey): a repeated submit returns the original note. */
  insertNote(note: TaskNoteRecord): Promise<{ note: TaskNoteRecord; created: boolean }>;
  notes(organizationId: string, taskId: string, limit: number): Promise<TaskNoteRecord[]>;
  /** Unfinished tasks whose due time passed and that were not yet escalated for it. */
  dueForEscalation(now: Date, limit: number): Promise<TaskAssignmentRecord[]>;
  policies(organizationId: string): Promise<EscalationPolicyRecord[]>;
  policyFor(organizationId: string, agentId: string): Promise<EscalationPolicyRecord | undefined>;
  savePolicy(policy: EscalationPolicyRecord): Promise<EscalationPolicyRecord>;
  findPolicy(organizationId: string, agentId: string | null): Promise<EscalationPolicyRecord | undefined>;
}

export interface WorkflowPorts {
  workflow: WorkflowRepository;
  tasks: { findById(organizationId: string, id: string): Promise<TaskRecord | undefined> };
  requireOperate(principal: Principal, agentId: string, skillId: string | null): Promise<void>;
  canOperate(organizationId: string, membershipId: string, agentId: string, skillId: string | null): Promise<boolean>;
  /** True when the membership is currently an enabled administrator or operator (agent not considered). */
  isReviewer(organizationId: string, membershipId: string): Promise<boolean>;
  /** Display names keyed by user ID and membership ID, for people in this organization only. */
  names(organizationId: string, userIds: string[], membershipIds: string[]): Promise<Record<string, string>>;
  freshen(organizationId: string, taskId: string): Promise<void>;
  audit(principal: Principal | null, organizationId: string, action: string, targetId: string, eventKey: string): Promise<void>;
}

export interface WorkflowUnitOfWork {
  run<T>(work: (ports: WorkflowPorts) => Promise<T>): Promise<T>;
}
