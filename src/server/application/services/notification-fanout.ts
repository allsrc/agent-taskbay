import { randomUUID } from "node:crypto";
import type { NotificationEvent, NotificationKind, NotificationRecord } from "../../domain/notification-model";
import type { TaskRecord } from "../../domain/persistence-model";
import type { OutboxRepository } from "../ports/persistence";
import { NOTIFICATION_TOPIC, WEBHOOK_TOPIC, type DeliveryUnitOfWork, type FanoutPorts, type FanoutUnitOfWork, type NotificationChannel } from "../ports/notifications";
import type { Clock } from "../ports/clock";

export const MAX_FANOUT_ATTEMPTS = 5;
export const MAX_DELIVERY_ATTEMPTS = 8;
export const MAX_NEEDS_INPUT_RECIPIENTS = 25;
const OPEN = ["pending", "changes_requested"];

/** Called in the transaction that causes the event; people and wording are resolved later from current state. */
export function enqueueNotificationEvent(outbox: OutboxRepository, organizationId: string, event: NotificationEvent, now: Date) {
  return outbox.enqueue({ id: randomUUID(), organizationId, topic: NOTIFICATION_TOPIC, aggregateType: "notification", aggregateId: event.subjectId ?? event.taskId ?? organizationId,
    payloadJson: event as never, status: "pending", availableAt: now, attempts: 0, leaseOwner: null, leaseUntil: null, lastError: null, createdAt: now, processedAt: null });
}

const quote = (text: string) => `“${text}”`;
const taskLabel = (task: TaskRecord | undefined, agent: string) => (task?.title?.trim() ? task.title.trim().slice(0, 120) : agent);

interface Resolved { title: string; body: string; link: string; recipients: string[] }

/**
 * Decides who is told, and what they read, from the event and the current state. Wording never includes the content
 * of proposals, rationales or notes: only titles the console already shows to anyone who can open the task.
 */
async function resolve(ports: FanoutPorts, organizationId: string, event: NotificationEvent): Promise<Resolved | undefined> {
  // An administrator's own check that the pipeline and channel work end to end; it names no task or approval.
  if (event.kind === "test") return { title: "Test notification", body: "If you can read this, notifications are working.", link: "/notifications", recipients: event.toMembershipId ? [event.toMembershipId] : [] };
  const task = event.taskId ? await ports.tasks.findById(organizationId, event.taskId) : undefined;
  const request = event.subjectId && event.kind.startsWith("approval.") ? await ports.requests.findRequest(organizationId, event.subjectId) : undefined;
  if (event.kind.startsWith("approval.") && (!request || !task)) return undefined;
  const subject = request ?? task;
  const agentName = subject ? await ports.agentName(organizationId, subject.agentId) : "Agent";
  const actorMembership = event.actorUserId ? await ports.membershipOfUser(organizationId, event.actorUserId) : undefined;

  const eligibleReviewers = async (target: { agentId: string; skillId: string | null }, exclude: Array<string | undefined>) => {
    const out: string[] = [];
    for (const membership of await ports.reviewers(organizationId))
      if (!exclude.includes(membership) && await ports.membershipCan(organizationId, membership, target.agentId, target.skillId, "operate")) out.push(membership);
    return out;
  };
  const filterReadable = async (membershipIds: Array<string | null | undefined>, target: { agentId: string; skillId: string | null }) => {
    const out: string[] = [];
    for (const id of new Set(membershipIds.filter((candidate): candidate is string => Boolean(candidate) && candidate !== actorMembership)))
      if (await ports.membershipCan(organizationId, id, target.agentId, target.skillId, "read")) out.push(id);
    return out;
  };

  if (request) {
    const link = `/approvals/${request.id}`;
    const requester = request.requesterUserId ? await ports.membershipOfUser(organizationId, request.requesterUserId) : undefined;
    const target = { agentId: request.agentId, skillId: request.skillId };
    const open = OPEN.includes(request.status);
    switch (event.kind) {
      case "approval.requested":
      case "approval.revised": {
        if (!open) return undefined;
        const exclude = [actorMembership, ...(request.policy.separationOfDuties ? [requester] : [])];
        const recipients = request.assignedMembershipId ? await filterReadable([request.assignedMembershipId], target) : await eligibleReviewers(target, exclude);
        return { title: event.kind === "approval.requested" ? "Approval needed" : "Revised proposal to review", link, recipients,
          body: `${quote(request.title)} from ${agentName}${request.risk === "high" ? " (high risk)" : ""}` };
      }
      case "approval.assigned":
        return { title: "Approval assigned to you", link, body: `${quote(request.title)} from ${agentName}`, recipients: await filterReadable([event.toMembershipId], target) };
      case "approval.decided": {
        const words: Record<string, string> = { approve: "approved", edit: "edited and approved", reject: "rejected", request_changes: "sent back for changes" };
        const verb = words[event.detail ?? ""] ?? "decided";
        const reviewer = actorMembership ? await ports.displayName(organizationId, actorMembership) : "A reviewer";
        return { title: `Your request was ${verb}`, link, body: `${reviewer} ${verb} ${quote(request.title)}`, recipients: await filterReadable([requester], target) };
      }
      case "approval.expiring": {
        if (!open) return undefined;
        const exclude = [requester && request.policy.separationOfDuties ? requester : undefined];
        const recipients = request.assignedMembershipId ? await filterReadable([request.assignedMembershipId], target) : await eligibleReviewers(target, exclude);
        return { title: "Approval expiring soon", link, body: `${quote(request.title)} expires within 15 minutes`, recipients };
      }
      case "approval.expired":
        return { title: "Approval expired", link, body: `${quote(request.title)} expired without a decision`, recipients: await filterReadable([requester, request.assignedMembershipId], target) };
      case "approval.superseded":
        return { title: "Approval superseded", link, body: `${quote(request.title)} can no longer authorize anything`, recipients: await filterReadable([requester, request.assignedMembershipId], target) };
      default: return undefined;
    }
  }

  if (!task) return undefined;
  const link = `/tasks/${task.id}`;
  const target = { agentId: task.agentId, skillId: task.skillId ?? null };
  const label = taskLabel(task, agentName);
  const assignment = await ports.assignments.findAssignment(organizationId, task.id);
  switch (event.kind) {
    case "task.assigned":
      return { title: "Task assigned to you", link, body: `${quote(label)} from ${agentName}`, recipients: await filterReadable([event.toMembershipId], target) };
    case "task.escalated": {
      const to = event.toMembershipId ? await ports.displayName(organizationId, event.toMembershipId) : undefined;
      const from = event.fromMembershipId ? await ports.displayName(organizationId, event.fromMembershipId) : "the previous owner";
      return { title: "Overdue task escalated", link, recipients: await filterReadable([event.toMembershipId, event.fromMembershipId], target),
        body: to ? `${quote(label)} moved from ${from} to ${to}` : `${quote(label)} is overdue; ${from} keeps it` };
    }
    case "task.needs_input": {
      const owner = assignment?.assigneeMembershipId;
      const recipients = owner ? await filterReadable([owner], target) : (await eligibleReviewers(target, [actorMembership])).slice(0, MAX_NEEDS_INPUT_RECIPIENTS);
      return { title: event.detail === "auth" ? "Authorization needed" : "Input needed", link, body: `${agentName}: ${quote(label)}`, recipients };
    }
    case "task.finished":
    case "task.failed": {
      const owner = assignment?.assigneeMembershipId;
      return { title: event.kind === "task.finished" ? "Task finished" : "Task failed", link, body: `${agentName}: ${quote(label)}`, recipients: owner ? await filterReadable([owner], target) : [] };
    }
    default: return undefined;
  }
}

/** Turns queued events into inbox rows (and, when configured, one external delivery) exactly once each. */
export class NotificationFanout {
  constructor(private readonly work: FanoutUnitOfWork, private readonly channel?: NotificationChannel, private readonly clock: Clock = { now: () => new Date() }) {}

  async runOne() {
    const owner = randomUUID();
    const now = this.clock.now();
    const claimed = await this.work.run((ports) => ports.outbox.claim(NOTIFICATION_TOPIC, owner, now, new Date(now.getTime() + 30_000)));
    if (!claimed) return false;
    const { message } = claimed;
    const event = message.payloadJson as unknown as NotificationEvent;
    try {
      await this.work.run(async (ports) => {
        const resolved = await resolve(ports, message.organizationId, event);
        const finishedAt = this.clock.now();
        if (resolved && resolved.recipients.length > 0) {
          const record: NotificationRecord = { id: message.id, organizationId: message.organizationId, kind: event.kind as NotificationKind, taskId: event.taskId ?? null,
            subjectId: event.subjectId ?? null, actorUserId: event.actorUserId ?? null, title: resolved.title.slice(0, 200), body: resolved.body, link: resolved.link, createdAt: finishedAt };
          const created = await ports.notifications.insert(record, resolved.recipients, finishedAt);
          if (created) {
            await ports.freshen(message.organizationId, message.id);
            const slug = this.channel ? await ports.organizationSlug(message.organizationId) : undefined;
            if (this.channel && slug && this.channel.enabledFor(message.organizationId, slug))
              await ports.outbox.enqueue({ id: randomUUID(), organizationId: message.organizationId, topic: WEBHOOK_TOPIC, aggregateType: "notification", aggregateId: message.id,
                payloadJson: { notificationId: message.id }, status: "pending", availableAt: finishedAt, attempts: 0, leaseOwner: null, leaseUntil: null, lastError: null, createdAt: finishedAt, processedAt: null });
          }
        }
        if (!await ports.outbox.finish(message.id, message.organizationId, owner, finishedAt, { status: "processed", availableAt: finishedAt, processedAt: finishedAt, lastError: null }))
          throw new Error("Lease lost before completion.");
      });
    } catch {
      const failed = this.clock.now();
      const exhausted = message.attempts >= MAX_FANOUT_ATTEMPTS;
      await this.work.run((ports) => ports.outbox.finish(message.id, message.organizationId, owner, failed, exhausted
        ? { status: "failed", availableAt: failed, processedAt: null, lastError: "Notification could not be created after several attempts." }
        : { status: "pending", availableAt: new Date(failed.getTime() + Math.min(60_000, 1000 * 2 ** message.attempts)), processedAt: null, lastError: "Notification fan-out failed; retry scheduled." }));
    }
    return true;
  }
}

/** Sends each notification through the external channel with bounded retries; a failure never affects the inbox. */
export class NotificationDelivery {
  constructor(private readonly work: DeliveryUnitOfWork, private readonly channel: NotificationChannel, private readonly clock: Clock = { now: () => new Date() }) {}

  async runOne(signal: AbortSignal = new AbortController().signal) {
    const owner = randomUUID();
    const now = this.clock.now();
    const claimed = await this.work.run((ports) => ports.outbox.claim(WEBHOOK_TOPIC, owner, now, new Date(now.getTime() + 30_000)));
    if (!claimed) return false;
    const { message } = claimed;
    const outcome = await this.send(message.organizationId, (message.payloadJson as { notificationId: string }).notificationId, signal).then(() => undefined, (error: unknown) => error);
    const at = this.clock.now();
    await this.work.run((ports) => ports.outbox.finish(message.id, message.organizationId, owner, at, outcome === undefined
      ? { status: "processed", availableAt: at, processedAt: at, lastError: null }
      : message.attempts >= MAX_DELIVERY_ATTEMPTS
        ? { status: "failed", availableAt: at, processedAt: null, lastError: "Delivery failed after repeated attempts." }
        : { status: "pending", availableAt: new Date(at.getTime() + Math.min(600_000, 5000 * 2 ** (message.attempts - 1))), processedAt: null, lastError: "Delivery failed; retry scheduled." }));
    return true;
  }

  private async send(organizationId: string, notificationId: string, signal: AbortSignal) {
    const loaded = await this.work.run(async (ports) => ({ notification: await ports.notifications.find(organizationId, notificationId),
      slug: await ports.organizationSlug(organizationId), recipients: await ports.notifications.recipientNames(organizationId, notificationId) }));
    // A notification that no longer exists or whose organization left the channel is simply not sent.
    if (!loaded.notification || !loaded.slug || !this.channel.enabledFor(organizationId, loaded.slug)) return;
    await this.channel.send({ notification: loaded.notification, organizationSlug: loaded.slug, recipients: loaded.recipients, signal });
  }
}
