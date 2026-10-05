/** Browser-facing shapes returned by /api/decisions. Mirrors the server views; carries no secrets. */
export type DecisionStatus = "pending" | "approved" | "rejected" | "changes_requested" | "expired" | "superseded";
export type DecisionOutcome = "approve" | "reject" | "edit" | "request_changes" | "delegate";
export type DecisionRisk = "low" | "medium" | "high";
export type ExecutionStatus = "pending" | "dispatching" | "succeeded" | "failed" | "uncertain";

/** One typed action today; new kinds add a variant here and a renderer in the approvals component registry. */
export interface ProposedAction { kind: "send_message"; text: string; data?: Record<string, unknown> }

export interface DecisionRequestView {
  id: string; taskId: string; agentId: string; tenant: string; skillId: string | null; kind: "send_message";
  status: DecisionStatus; title: string; summary: string; risk: DecisionRisk;
  policy: { allowedOutcomes: DecisionOutcome[]; separationOfDuties: boolean };
  requesterUserId?: string | null; assignedMembershipId: string | null; currentRevision: number; expiresAt: string; createdAt: string; updatedAt: string;
  agentName?: string; taskTitle?: string | null; taskState?: string | null; taskRemoteId?: string | null;
}
export interface DecisionRevisionView { id: string; number: number; action: ProposedAction; digest: string; authorType: string; authorUserId: string | null; createdAt: string }
export interface DecisionView {
  id: string; requestId: string; revisionId: string; revisionDigest: string; outcome: DecisionOutcome; rationale: string;
  reviewerUserId: string; reviewerMembershipId: string; delegateMembershipId: string | null; createdAt: string;
}
export interface DecisionExecutionView {
  id: string; decisionId: string; revisionId: string; revisionDigest: string; commandId: string; messageId: string;
  status: ExecutionStatus; observedTaskState: string | null; observedAt: string | null; error: string | null; updatedAt: string;
}
export interface DecisionDetail { request: DecisionRequestView; revisions: DecisionRevisionView[]; decisions: DecisionView[]; executions: DecisionExecutionView[];
  /** Display names keyed by user ID and membership ID, for people in this organization only. */
  people: Record<string, string>;
  /** The signed-in reviewer, so the page can explain why a decision is unavailable. */
  viewer: { userId: string; membershipId: string; role: string } }
export interface ReviewerOption { membershipId: string; displayName: string; role: string; self: boolean }
