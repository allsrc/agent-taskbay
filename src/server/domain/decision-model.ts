import type { JsonValue } from "./persistence-model";

/** Approval-grade outcomes. `delegate` reassigns without deciding; `request_changes` returns to the proposer. */
export type DecisionOutcome = "approve" | "reject" | "edit" | "request_changes" | "delegate";
export type DecisionRequestStatus = "pending" | "approved" | "rejected" | "changes_requested" | "expired" | "superseded";
export type DecisionRisk = "low" | "medium" | "high";
export type ExecutionStatus = "pending" | "dispatching" | "succeeded" | "failed" | "uncertain";

/**
 * The only typed action in this slice: send one reply message into the task the request is scoped to.
 * Scope (agent, tenant, skill, task) is fixed on the request, never taken from the action content.
 */
export interface ProposedAction {
  kind: "send_message";
  text: string;
  data?: Record<string, JsonValue>;
}

/** Reviewer policy snapshot recorded with each request and with each decision made under it. */
export interface DecisionPolicy {
  allowedOutcomes: DecisionOutcome[];
  /** When true, the user who requested the decision cannot decide it. */
  separationOfDuties: boolean;
}

export interface DecisionRequestRecord {
  id: string;
  organizationId: string;
  taskId: string;
  agentId: string;
  tenant: string;
  skillId: string | null;
  kind: "send_message";
  status: DecisionRequestStatus;
  requestKey: string;
  title: string;
  summary: string;
  risk: DecisionRisk;
  policy: DecisionPolicy;
  requesterUserId: string | null;
  assignedMembershipId: string | null;
  currentRevision: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/** Immutable. A revision's digest is the identity that approval and execution both reference. */
export interface DecisionRevisionRecord {
  id: string;
  organizationId: string;
  requestId: string;
  number: number;
  action: ProposedAction;
  digest: string;
  authorType: "agent" | "user" | "system";
  authorUserId: string | null;
  createdAt: Date;
}

/** Immutable. The row alone identifies who decided which exact revision, when, and why. */
export interface DecisionRecord {
  id: string;
  organizationId: string;
  requestId: string;
  revisionId: string;
  revisionDigest: string;
  outcome: DecisionOutcome;
  rationale: string;
  reviewerUserId: string;
  reviewerMembershipId: string;
  delegateMembershipId: string | null;
  idempotencyKey: string;
  inputDigest: string;
  policy: DecisionPolicy;
  createdAt: Date;
}

/** Correlates the approved revision with the dispatched command and the observed task outcome. */
export interface DecisionExecutionRecord {
  id: string;
  organizationId: string;
  decisionId: string;
  revisionId: string;
  revisionDigest: string;
  commandId: string;
  messageId: string;
  status: ExecutionStatus;
  observedTaskState: string | null;
  observedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}
