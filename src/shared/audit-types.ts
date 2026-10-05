/** Browser-facing shapes returned by /api/audit. Read-only; entries carry no secrets and never note bodies. */
export type AuditGroup = "all" | "approvals" | "ownership" | "commands" | "access";
export interface AuditEntryView {
  key: string; at: string; kind: string; actorUserId: string | null; taskId: string | null; subjectId: string | null;
  data: Record<string, unknown>;
}
export interface AuditPageView {
  entries: AuditEntryView[];
  /** Display names keyed by user ID and membership ID, for people in this organization only. */
  people: Record<string, string>;
  context: Record<string, { title: string | null; agentName: string; state: string }>;
  next: string | null;
  viewer: { userId: string; membershipId: string; role: string };
}
