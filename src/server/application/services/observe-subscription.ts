import type { Clock } from "../ports/clock";
import type { A2ASubscriptionGateway, SubscriptionEventSink, SubscriptionUnitOfWork } from "../ports/subscriptions";
import { SubscriptionUnsupported } from "../ports/subscriptions";
import type { SubscriptionRecord } from "../../domain/persistence-model";
import { eventSubject } from "./task-projection";
import { observationPaused, SUBSCRIPTION_LEASE_MS } from "./subscription-state";

export class SubscriptionWorker {
  constructor(private readonly work: SubscriptionUnitOfWork, private readonly gateway: A2ASubscriptionGateway,
    private readonly sink: SubscriptionEventSink, private readonly clock: Clock = { now: () => new Date() }) {}

  async runOne(owner: string, shutdown: AbortSignal): Promise<boolean> {
    const now = this.clock.now();
    const lease = await this.work.run((ports) => ports.subscriptions.claim(owner, now, new Date(now.getTime() + SUBSCRIPTION_LEASE_MS)));
    if (!lease) return false;
    const controller = new AbortController();
    const signal = AbortSignal.any([shutdown, controller.signal]);
    // Serial heartbeats avoid overlapping transactions and abort a lost owner.
    let renewing = false;
    const heartbeat = setInterval(() => {
      if (renewing) return;
      renewing = true;
      const time = this.clock.now();
      void this.work.run((ports) => ports.subscriptions.renew(lease, time, new Date(time.getTime() + SUBSCRIPTION_LEASE_MS)))
        .then((owned) => { if (!owned) controller.abort(); }, () => controller.abort()).finally(() => { renewing = false; });
    }, SUBSCRIPTION_LEASE_MS / 3);
    heartbeat.unref?.();
    try {
      const task = await this.work.run((ports) => ports.tasks.findById(lease.organizationId, lease.taskId));
      if (!task?.remoteTaskId || observationPaused(task.state)) {
        await this.finish(lease, "stopped", null); return true;
      }
      const agent = await this.work.run((ports) => ports.agents.findById(lease.organizationId, task.agentId));
      if (!agent?.enabled) { await this.finish(lease, "stopped", "Agent is unavailable or disabled."); return true; }
      const session = await this.gateway.subscribe(agent, task, signal);
      const ingest = this.sink.open(lease, task, session.metadata);
      for await (const event of session.events) {
        if (signal.aborted) break;
        // A peer must never redirect observation into a different task.
        if (eventSubject(event).remoteTaskId !== task.remoteTaskId) throw new Error("Unexpected stream task identity.");
        if (await ingest(event)) return true;
      }
      await this.finish(lease, "pending", shutdown.aborted ? null : "Stream ended before the task paused; reconnect scheduled.", shutdown.aborted ? 0 : this.backoff(lease));
    } catch (error) {
      await this.finish(lease, error instanceof SubscriptionUnsupported ? "stopped" : "pending",
        shutdown.aborted ? null : error instanceof SubscriptionUnsupported ? "Agent does not support task streaming." : "Task stream unavailable; reconnect scheduled.",
        shutdown.aborted ? 0 : this.backoff(lease));
    } finally { clearInterval(heartbeat); controller.abort(); }
    return true;
  }

  private backoff(lease: SubscriptionRecord) { return Math.min(30_000, 1000 * 2 ** Math.min(lease.attempts - 1, 5)); }
  private finish(lease: SubscriptionRecord, status: SubscriptionRecord["status"], lastError: string | null, delay = 0) {
    const now = this.clock.now();
    return this.work.run((ports) => ports.subscriptions.finish(lease, now, { status, lastError, availableAt: new Date(now.getTime() + delay) }));
  }
}
