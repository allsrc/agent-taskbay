/** Browser-facing shapes returned by /api/tasks/[id]/workflow and the task list. */
export type AssignmentEventKind = "assigned" | "claimed" | "released" | "due_set" | "due_cleared" | "escalated";
export interface AssignmentView {
  assigneeMembershipId: string | null; claimedAt: string | null; dueAt: string | null;
  escalationLevel: number; escalatedAt: string | null; updatedAt: string;
}
export interface AssignmentEventView {
  id: string; kind: AssignmentEventKind; actorUserId: string | null; fromMembershipId: string | null; toMembershipId: string | null;
  dueAt: string | null; createdAt: string;
}
export interface TaskNoteView { id: string; authorUserId: string; body: string; createdAt: string }
export interface WorkflowDetail {
  assignment: AssignmentView | null; events: AssignmentEventView[]; notes: TaskNoteView[];
  /** Display names keyed by user ID and membership ID, for people in this organization only. */
  people: Record<string, string>;
  viewer: { userId: string; membershipId: string; role: string };
}
/** Summary attached to each Tasks list row. */
export interface WorkflowSummary { assigneeMembershipId: string | null; assigneeName: string | null; dueAt: string | null; escalationLevel: number }
export interface EscalationPolicyView { id: string; agentId: string | null; targetMembershipId: string; enabled: boolean; updatedAt: string }
