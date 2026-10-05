/** Ownership and due time of a task, independent of the remote A2A task state. */
export interface TaskAssignmentRecord {
  id: string;
  organizationId: string;
  taskId: string;
  assigneeMembershipId: string | null;
  claimedAt: Date | null;
  dueAt: Date | null;
  /** How many times the sweeper escalated this task; each new due time re-arms escalation. */
  escalationLevel: number;
  escalatedAt: Date | null;
  updatedAt: Date;
  version: number;
}

export type AssignmentEventKind = "assigned" | "claimed" | "released" | "due_set" | "due_cleared" | "escalated";

/** Immutable history of ownership changes; actor is null when the system escalated. */
export interface AssignmentEventRecord {
  id: string;
  organizationId: string;
  taskId: string;
  kind: AssignmentEventKind;
  actorUserId: string | null;
  fromMembershipId: string | null;
  toMembershipId: string | null;
  dueAt: Date | null;
  createdAt: Date;
}

/** Internal, append-only commentary that is never sent to the agent. */
export interface TaskNoteRecord {
  id: string;
  organizationId: string;
  taskId: string;
  noteKey: string;
  authorUserId: string;
  body: string;
  createdAt: Date;
}

/** Where overdue work goes. An agent-specific policy overrides the organization-wide one (agentId null). */
export interface EscalationPolicyRecord {
  id: string;
  organizationId: string;
  agentId: string | null;
  targetMembershipId: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
