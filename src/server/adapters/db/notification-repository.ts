import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { InboxQuery, NotificationRepository } from "../../application/ports/notifications";
import type { InboxItem, NotificationRecord } from "../../domain/notification-model";
import { MembershipEntity, NotificationEntity, NotificationRecipientEntity, UserEntity } from "./entities";

const record = (entity: NotificationEntity): NotificationRecord => ({ id: entity.id, organizationId: entity.organizationId, kind: entity.kind, taskId: entity.taskId ?? null,
  subjectId: entity.subjectId ?? null, actorUserId: entity.actorUserId ?? null, title: entity.title, body: entity.body, link: entity.link, createdAt: entity.createdAt });

export class MikroOrmNotificationRepository implements NotificationRepository {
  constructor(private readonly em: EntityManager) {}

  async insert(notification: NotificationRecord, membershipIds: string[], now: Date) {
    // The ID is the event's outbox ID, so a reprocessed event hits the primary key and writes nothing.
    const inserted = await this.em.getConnection().execute(
      `insert into notifications (id, organization_id, kind, task_id, subject_id, actor_user_id, title, body, link, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict (id) do nothing returning id`,
      [notification.id, notification.organizationId, notification.kind, notification.taskId, notification.subjectId, notification.actorUserId, notification.title,
        notification.body, notification.link, notification.createdAt], "all", this.em.getTransactionContext());
    if (!inserted.length) return false;
    for (const membershipId of new Set(membershipIds))
      this.em.create(NotificationRecipientEntity, { id: randomUUID(), notificationId: notification.id, organizationId: notification.organizationId, membershipId, readAt: null, createdAt: now });
    await this.em.flush();
    return true;
  }
  async find(organizationId: string, id: string) {
    const entity = await this.em.findOne(NotificationEntity, { organizationId, id }, { refresh: true });
    return entity ? record(entity) : undefined;
  }
  async recipientNames(organizationId: string, id: string) {
    const rows = await this.em.find(NotificationRecipientEntity, { organizationId, notificationId: id }, { refresh: true });
    const memberships = rows.length ? await this.em.find(MembershipEntity, { organizationId, id: { $in: rows.map((row) => row.membershipId) } }) : [];
    const users = memberships.length ? await this.em.find(UserEntity, { id: { $in: memberships.map((membership) => membership.userId) } }) : [];
    return users.map((user) => user.displayName).sort();
  }
  async inbox(organizationId: string, membershipId: string, query: InboxQuery) {
    const rows = await this.em.find(NotificationRecipientEntity, { organizationId, membershipId,
      ...(query.unreadOnly ? { readAt: null } : {}),
      ...(query.before ? { $or: [{ createdAt: { $lt: query.before.createdAt } }, { createdAt: query.before.createdAt, id: { $lt: query.before.id } }] } : {}) },
    { orderBy: { createdAt: "desc", id: "desc" }, limit: query.limit, refresh: true });
    if (!rows.length) return [];
    const notifications = new Map((await this.em.find(NotificationEntity, { organizationId, id: { $in: rows.map((row) => row.notificationId) } }, { refresh: true })).map((entity) => [entity.id, record(entity)]));
    return rows.flatMap((row): InboxItem[] => {
      const notification = notifications.get(row.notificationId);
      return notification ? [{ ...notification, recipientId: row.id, readAt: row.readAt ?? null }] : [];
    });
  }
  async markRead(organizationId: string, membershipId: string, ids: string[], now: Date) {
    if (!ids.length) return 0;
    return this.em.nativeUpdate(NotificationRecipientEntity, { organizationId, membershipId, readAt: null, notificationId: { $in: ids } }, { readAt: now });
  }
  async markAllRead(organizationId: string, membershipId: string, now: Date) {
    return this.em.nativeUpdate(NotificationRecipientEntity, { organizationId, membershipId, readAt: null }, { readAt: now });
  }
}
