import type { InboxItem, NotificationEvent, NotificationRecord } from "../../domain/notification-model";
import type { DecisionRequestRecord } from "../../domain/decision-model";
import type { OutboxMessageRecord, TaskRecord } from "../../domain/persistence-model";
import type { TaskAssignmentRecord } from "../../domain/workflow-model";
import type { OutboxRepository } from "./persistence";

export const NOTIFICATION_TOPIC = "notification.event";
export const WEBHOOK_TOPIC = "notification.webhook";

export interface InboxQuery { unreadOnly: boolean; limit: number; before?: { createdAt: Date; id: string } }

export interface NotificationRepository {
  /** Idempotent on the notification ID: returns false, writing nothing, when it already exists. */
  insert(notification: NotificationRecord, membershipIds: string[], now: Date): Promise<boolean>;
  find(organizationId: string, id: string): Promise<NotificationRecord | undefined>;
  recipientNames(organizationId: string, id: string): Promise<string[]>;
  inbox(organizationId: string, membershipId: string, query: InboxQuery): Promise<InboxItem[]>;
  /** Marks only the caller's own rows; unknown or foreign IDs change nothing. */
  markRead(organizationId: string, membershipId: string, ids: string[], now: Date): Promise<number>;
  markAllRead(organizationId: string, membershipId: string, now: Date): Promise<number>;
}

export interface FanoutPorts {
  notifications: NotificationRepository;
  outbox: OutboxRepository;
  requests: { findRequest(organizationId: string, id: string): Promise<DecisionRequestRecord | undefined> };
  tasks: { findById(organizationId: string, id: string): Promise<TaskRecord | undefined> };
  assignments: { findAssignment(organizationId: string, taskId: string): Promise<TaskAssignmentRecord | undefined> };
  agentName(organizationId: string, agentId: string): Promise<string>;
  membershipOfUser(organizationId: string, userId: string): Promise<string | undefined>;
  /** Enabled administrators and operators of the organization. */
  reviewers(organizationId: string): Promise<string[]>;
  membershipCan(organizationId: string, membershipId: string, agentId: string, skillId: string | null, permission: "read" | "operate"): Promise<boolean>;
  displayName(organizationId: string, membershipId: string): Promise<string>;
  organizationSlug(organizationId: string): Promise<string | undefined>;
  freshen(organizationId: string, notificationId: string): Promise<void>;
}

export interface FanoutUnitOfWork {
  /** One transaction; claim and finish are fenced by the lease owner. */
  run<T>(work: (ports: FanoutPorts) => Promise<T>): Promise<T>;
}

/** An external channel. Delivery is at least once; receivers deduplicate on the notification ID. */
export interface NotificationChannel {
  readonly name: string;
  /** True when this organization's notifications go through the channel. */
  enabledFor(organizationId: string, organizationSlug: string): boolean;
  send(delivery: { notification: NotificationRecord; organizationSlug: string; recipients: string[]; signal: AbortSignal }): Promise<void>;
}

export interface DeliveryPorts {
  notifications: NotificationRepository;
  outbox: OutboxRepository;
  organizationSlug(organizationId: string): Promise<string | undefined>;
}
export interface DeliveryUnitOfWork { run<T>(work: (ports: DeliveryPorts) => Promise<T>): Promise<T>; }

export type EventMessage = OutboxMessageRecord & { payloadJson: NotificationEvent };
