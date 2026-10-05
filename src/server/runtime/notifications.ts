import type { MikroORM } from "@mikro-orm/core";
import { z } from "zod";
import { withJobEntityManager } from "../adapters/db/orm";
import { MikroOrmNotificationRepository } from "../adapters/db/notification-repository";
import { MikroOrmDecisionRepository } from "../adapters/db/decision-repository";
import { MikroOrmWorkflowRepository } from "../adapters/db/workflow-repository";
import { OrganizationEntity, OutboxMessageEntity } from "../adapters/db/entities";
import { loadNotifyConfig, WebhookChannel } from "../adapters/notify/webhook-channel";
import { WEBHOOK_TOPIC, type DeliveryUnitOfWork, type FanoutPorts, type FanoutUnitOfWork } from "../application/ports/notifications";
import { NotificationDelivery, NotificationFanout } from "../application/services/notification-fanout";
import type { InboxItem } from "../domain/notification-model";
import { AuthorizationError } from "../application/services/authorization";
import { enqueueNotificationEvent } from "../application/services/notification-fanout";
import { requirePrincipal } from "./decisions";
import { sharedPorts } from "./shared-ports";

type Em = Parameters<Parameters<typeof withJobEntityManager>[0]>[0];

// Read once per process; a bad value fails loudly where the workers start, and an absent one means in-app only.
let channel: WebhookChannel | null | undefined;
export function notificationChannel() {
  if (channel === undefined) { const config = loadNotifyConfig(); channel = config.webhook ? new WebhookChannel(config.webhook) : null; }
  return channel ?? undefined;
}
export function resetNotificationChannelForTests() { channel = undefined; }

function fanoutPorts(em: Em): FanoutPorts {
  const shared = sharedPorts(em);
  return { notifications: new MikroOrmNotificationRepository(em), outbox: shared.outbox, requests: new MikroOrmDecisionRepository(em), tasks: shared.tasks,
    assignments: new MikroOrmWorkflowRepository(em), agentName: shared.agentName, membershipOfUser: shared.membershipOfUser, reviewers: shared.reviewers,
    membershipCan: shared.membershipCan, displayName: shared.displayName, freshen: shared.freshen,
    organizationSlug: async (organizationId) => (await em.findOne(OrganizationEntity, { id: organizationId }))?.slug };
}
export function createNotificationFanout(options: { orm?: MikroORM; channel?: WebhookChannel } = {}) {
  const work: FanoutUnitOfWork = { run: (callback) => withJobEntityManager((em) => em.transactional((transaction) => callback(fanoutPorts(transaction))), options.orm) };
  return new NotificationFanout(work, options.channel ?? notificationChannel());
}
export function createNotificationDelivery(options: { orm?: MikroORM; channel?: WebhookChannel } = {}) {
  const external = options.channel ?? notificationChannel();
  if (!external) return undefined;
  const work: DeliveryUnitOfWork = { run: (callback) => withJobEntityManager((em) => em.transactional((transaction) => callback({
    notifications: new MikroOrmNotificationRepository(transaction), outbox: sharedPorts(transaction).outbox,
    organizationSlug: async (organizationId) => (await transaction.findOne(OrganizationEntity, { id: organizationId }))?.slug })), options.orm) };
  return new NotificationDelivery(work, external);
}

export const inboxQuerySchema = z.object({ unread: z.enum(["true", "false"]).default("false"), limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.string().max(300).optional() }).strict();
export const markReadSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100).optional(), all: z.literal(true).optional() }).strict()
  .refine((value) => Boolean(value.ids) !== Boolean(value.all), "Provide either ids or all.");

/** Keyset position is the recipient row (time, recipient ID), which is what the inbox is ordered by. */
const encode = (item: Pick<InboxItem, "createdAt" | "recipientId">) => Buffer.from(JSON.stringify([item.createdAt.toISOString(), item.recipientId])).toString("base64url");
function decode(cursor: string): { createdAt: Date; id: string } | undefined {
  try { const [at, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [string, string]; const createdAt = new Date(at);
    return typeof id === "string" && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : undefined; } catch { return undefined; }
}
export const inboxView = (item: InboxItem) => ({ id: item.id, kind: item.kind, title: item.title, body: item.body, link: item.link, taskId: item.taskId,
  createdAt: item.createdAt.toISOString(), readAt: item.readAt?.toISOString() ?? null });

/**
 * The signed-in member's own notifications. Anything about a task the member can no longer read is hidden, so revoking
 * access also withdraws what the notification said.
 */
export async function listInbox(query: { unreadOnly: boolean; limit: number; cursor?: string }, options: { orm?: MikroORM } = {}) {
  const principal = requirePrincipal();
  let before = query.cursor ? decode(query.cursor) : undefined;
  if (query.cursor && !before) throw Object.assign(new Error("Invalid cursor."), { status: 400 });
  return withJobEntityManager(async (em) => {
    const repository = new MikroOrmNotificationRepository(em);
    const tasks = sharedPorts(em).tasks;
    const visibleTasks = new Map<string, boolean>();
    const visible = async (item: InboxItem) => {
      if (!item.taskId) return true;
      if (!visibleTasks.has(item.taskId)) visibleTasks.set(item.taskId, Boolean(await tasks.findById(principal.organizationId, item.taskId)));
      return visibleTasks.get(item.taskId)!;
    };
    const items: InboxItem[] = []; let next: string | null = null;
    for (let round = 0; round < 5 && items.length < query.limit; round++) {
      const rows = await repository.inbox(principal.organizationId, principal.membershipId, { unreadOnly: query.unreadOnly, limit: query.limit + 1, before });
      for (const row of rows.slice(0, query.limit)) { if (items.length < query.limit && await visible(row)) items.push(row); }
      const examined = rows.slice(0, query.limit);
      if (rows.length > query.limit) { before = { createdAt: examined.at(-1)!.createdAt, id: examined.at(-1)!.recipientId }; next = encode(examined.at(-1)!); } else { next = null; break; }
      if (items.length >= query.limit) break;
    }
    const unreadRows = await repository.inbox(principal.organizationId, principal.membershipId, { unreadOnly: true, limit: 100 });
    let unread = 0; for (const row of unreadRows) if (await visible(row)) unread += 1;
    return { items: items.map(inboxView), next, unread };
  }, options.orm);
}

export async function markRead(input: { ids?: string[]; all?: true }, options: { orm?: MikroORM } = {}) {
  const principal = requirePrincipal();
  return withJobEntityManager((em) => em.transactional(async (transaction) => {
    const repository = new MikroOrmNotificationRepository(transaction);
    const now = new Date();
    const updated = input.all ? await repository.markAllRead(principal.organizationId, principal.membershipId, now) : await repository.markRead(principal.organizationId, principal.membershipId, input.ids ?? [], now);
    // Other tabs and devices of this person re-query on the shared signal; their membership ID is a stable aggregate.
    if (updated > 0) await sharedPorts(transaction).freshen(principal.organizationId, principal.membershipId);
    return updated;
  }), options.orm);
}

/** Administrator view of the external channel: whether it is on, where it goes (host only) and how deliveries are faring. */
export async function channelStatus(options: { orm?: MikroORM } = {}) {
  const principal = requirePrincipal();
  if (principal.role !== "admin") throw new AuthorizationError();
  const external = notificationChannel();
  return withJobEntityManager(async (em) => {
    const rows = await em.getConnection().execute(
      "select status, count(*)::int as count from outbox_messages where organization_id = ? and topic = ? group by status", [principal.organizationId, WEBHOOK_TOPIC]) as Array<{ status: string; count: number }>;
    const counts = Object.fromEntries(rows.map((row) => [row.status, row.count]));
    const failed = await em.findOne(OutboxMessageEntity, { organizationId: principal.organizationId, topic: WEBHOOK_TOPIC, status: "failed" }, { orderBy: { createdAt: "desc" } });
    const slug = (await em.findOne(OrganizationEntity, { id: principal.organizationId }))?.slug;
    return { configured: Boolean(external), enabledForOrganization: Boolean(external && slug && external.enabledFor(principal.organizationId, slug)), host: external?.host ?? null,
      counts: { pending: counts.pending ?? 0, processing: counts.processing ?? 0, delivered: counts.processed ?? 0, failed: counts.failed ?? 0 },
      lastFailure: failed ? { at: failed.createdAt.toISOString(), message: failed.lastError } : null };
  }, options.orm);
}

/** Queues a notification to the administrator through the real pipeline, including the external channel. */
export async function sendTestNotification(options: { orm?: MikroORM } = {}) {
  const principal = requirePrincipal();
  if (principal.role !== "admin") throw new AuthorizationError();
  await withJobEntityManager((em) => em.transactional(async (transaction) => {
    await enqueueNotificationEvent(sharedPorts(transaction).outbox, principal.organizationId, { kind: "test", actorUserId: principal.userId, toMembershipId: principal.membershipId }, new Date());
  }), options.orm);
}
