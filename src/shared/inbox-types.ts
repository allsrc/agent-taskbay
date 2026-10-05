/** Browser-facing shapes returned by /api/inbox. One row per task or approval request the caller may read. */
export type InboxKind = "task" | "approval";
export type InboxView = "all" | "active" | "needs-input" | "assigned" | "overdue" | "done";

export interface InboxItem {
  kind: InboxKind;
  /** Local task ID or decision request ID; the detail route is derived from `kind` and `id`. */
  id: string;
  /** For approvals, the task the request is about. */
  taskId: string;
  agentId: string;
  agentName: string;
  skillId: string | null;
  /** Task state (`TASK_STATE_*`) or approval status (`pending`, `changes_requested`, …). */
  status: string;
  /** True while the item still waits on someone: a non-terminal task or an unresolved approval. */
  open: boolean;
  title: string;
  risk: "low" | "medium" | "high" | null;
  assigneeMembershipId: string | null;
  assigneeName: string | null;
  /** Task due time. Approvals carry `expiresAt` instead. */
  dueAt: string | null;
  expiresAt: string | null;
  escalationLevel: number;
  updatedAt: string;
}
export interface InboxPageView { items: InboxItem[]; next: string | null }
