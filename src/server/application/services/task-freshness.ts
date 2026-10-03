import { randomUUID } from "node:crypto";
import type { OutboxRepository } from "../ports/persistence";
import type { Clock } from "../ports/clock";
import type { FreshnessUnitOfWork, RealtimePublisher } from "../ports/realtime";

export const TASK_FRESHNESS_TOPIC = "task.freshness";

/** Called in the transaction that changes a readable projection. */
export function enqueueTaskFreshness(outbox: OutboxRepository, organizationId: string, taskId: string, now: Date) {
  return outbox.enqueue({ id: randomUUID(), organizationId, topic: TASK_FRESHNESS_TOPIC,
    aggregateType: "task", aggregateId: taskId, payloadJson: {}, status: "pending",
    availableAt: now, attempts: 0, leaseOwner: null, leaseUntil: null, lastError: null,
    createdAt: now, processedAt: null });
}

export class FreshnessDispatcher {
  constructor(private readonly work: FreshnessUnitOfWork, private readonly publisher: RealtimePublisher,
    private readonly clock: Clock = { now: () => new Date() }) {}

  async runOne() {
    // Unique ownership per attempt prevents late acknowledgements after reclaim.
    const owner = randomUUID();
    const now = this.clock.now();
    const claimed = await this.work.run((outbox) => outbox.claim(TASK_FRESHNESS_TOPIC, owner, now, new Date(now.getTime() + 15_000)));
    if (!claimed) return false;
    const { message } = claimed;
    try {
      await this.publisher.publish(message.organizationId);
      const completed = this.clock.now();
      await this.work.run((outbox) => outbox.finish(message.id, message.organizationId, owner, completed,
        { status: "processed", availableAt: completed, processedAt: completed, lastError: null }));
    } catch {
      const failed = this.clock.now();
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(5, message.attempts - 1));
      await this.work.run((outbox) => outbox.finish(message.id, message.organizationId, owner, failed,
        { status: "pending", availableAt: new Date(failed.getTime() + delay), processedAt: null,
          lastError: "Freshness publication failed; retry scheduled." }));
    }
    return true;
  }
}
