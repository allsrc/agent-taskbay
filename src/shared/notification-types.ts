/** Browser-facing shapes returned by /api/notifications. Content-light by design: titles the console already shows. */
export type NotificationKind =
  | "approval.requested" | "approval.revised" | "approval.assigned" | "approval.decided" | "approval.expiring" | "approval.expired" | "approval.superseded"
  | "task.assigned" | "task.escalated" | "task.needs_input" | "task.finished" | "task.failed" | "test";
export interface NotificationView {
  id: string; kind: NotificationKind; title: string; body: string;
  /** Console-relative path. */
  link: string; taskId: string | null; createdAt: string; readAt: string | null;
}
export interface InboxPage { items: NotificationView[]; next: string | null; unread: number }
export interface ChannelStatus {
  configured: boolean; enabledForOrganization: boolean; host: string | null;
  counts: { pending: number; processing: number; delivered: number; failed: number };
  lastFailure: { at: string; message: string | null } | null;
}
