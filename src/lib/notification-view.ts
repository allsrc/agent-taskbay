import type { NotificationKind } from "@/shared/notification-types";

/** The badge shows at most "99+", since the server counts at most the latest hundred unread. */
export const unreadLabel = (unread: number) => unread > 99 ? "99+" : String(unread);

export const URGENT_KINDS: NotificationKind[] = ["approval.requested", "approval.revised", "approval.assigned", "approval.expiring", "task.needs_input", "task.escalated"];
/** Items that ask the reader to do something, as opposed to telling them something happened. */
export const needsAction = (kind: NotificationKind) => URGENT_KINDS.includes(kind);

export const KIND_LABEL: Record<NotificationKind, string> = {
  "approval.requested": "Approval", "approval.revised": "Approval", "approval.assigned": "Approval", "approval.decided": "Approval",
  "approval.expiring": "Approval", "approval.expired": "Approval", "approval.superseded": "Approval",
  "task.assigned": "Task", "task.escalated": "Task", "task.needs_input": "Task", "task.finished": "Task", "task.failed": "Task", test: "Test",
};

/** Only same-origin console paths are ever navigated to; anything else falls back to the Tasks list. */
export const safeLink = (link: string) => /^\/(?:approvals|tasks|notifications)(?:\/[0-9a-f-]{36})?$/.test(link) ? link : "/tasks";
