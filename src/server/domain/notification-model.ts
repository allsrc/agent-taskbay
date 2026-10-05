/** Actionable events people are told about. Each is raised in the transaction that causes it. */
export type NotificationKind =
  | "approval.requested" | "approval.revised" | "approval.assigned" | "approval.decided"
  | "approval.expiring" | "approval.expired" | "approval.superseded"
  | "task.assigned" | "task.escalated" | "task.needs_input" | "task.finished" | "task.failed"
  | "test";

/** The outbox payload. Recipients and wording are decided later by the fan-out worker, from current state. */
export interface NotificationEvent {
  kind: NotificationKind;
  /** Local task the event concerns; visibility of the notification follows this task. */
  taskId?: string;
  /** Approval request ID for approval events. */
  subjectId?: string;
  actorUserId?: string | null;
  fromMembershipId?: string | null;
  toMembershipId?: string | null;
  /** approve | reject | edit | request_changes for decisions; auth | input for needs_input. */
  detail?: string;
}

export interface NotificationRecord {
  /** Equals the outbox message ID of its event, so reprocessing can never duplicate it. */
  id: string;
  organizationId: string;
  kind: NotificationKind;
  taskId: string | null;
  subjectId: string | null;
  actorUserId: string | null;
  title: string;
  body: string;
  /** Console-relative path, never an absolute URL. */
  link: string;
  createdAt: Date;
}

export interface NotificationRecipientRecord {
  id: string;
  notificationId: string;
  organizationId: string;
  membershipId: string;
  /** Durable per-person read state. */
  readAt: Date | null;
  createdAt: Date;
}

/** One inbox row: a notification as seen by one recipient. */
export interface InboxItem extends NotificationRecord { recipientId: string; readAt: Date | null }
