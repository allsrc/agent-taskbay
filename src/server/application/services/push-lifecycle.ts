import type { Clock } from "../ports/clock";
import type { A2APushGateway, PushCredentials, PushUnitOfWork } from "../ports/push";
import { PushUnsupported } from "../ports/push";
import type { PushRegistrationRecord } from "../../domain/persistence-model";

export const PUSH_LEASE_MS = 15_000;
export const pushTerminal = (state: string) => ["COMPLETED", "FAILED", "CANCELED", "REJECTED"].includes(state.replace("TASK_STATE_", ""));

export class PushLifecycleWorker {
  constructor(private readonly work: PushUnitOfWork, private readonly gateway: A2APushGateway,
    private readonly credentials: PushCredentials, private readonly clock: Clock = { now: () => new Date() }) {}
  async adopt() { await this.work.run((ports) => ports.push.adopt(this.clock.now())); }
  async runOne(owner: string, shutdown: AbortSignal): Promise<boolean> {
    const now = this.clock.now();
    const lease = await this.work.run(async (ports) => {
      await ports.push.retireDisabled(now);
      return ports.push.claim(owner, now, new Date(now.getTime() + PUSH_LEASE_MS));
    });
    if (!lease) return false;
    const abort = new AbortController();
    const signal = AbortSignal.any([shutdown, abort.signal]);
    let renewing = false;
    const heartbeat = setInterval(() => {
      if (renewing) return;
      renewing = true;
      const time = this.clock.now();
      void this.work.run((ports) => ports.push.renew(lease, time, new Date(time.getTime() + PUSH_LEASE_MS)))
        .then((owned) => { if (!owned) abort.abort(); }, () => abort.abort()).finally(() => { renewing = false; });
    }, PUSH_LEASE_MS / 3);
    heartbeat.unref?.();
    try {
      const task = await this.work.run((ports) => ports.tasks.findById(lease.organizationId, lease.taskId));
      const agent = task && await this.work.run((ports) => ports.agents.findById(lease.organizationId, task.agentId));
      if (!task?.remoteTaskId || !agent) throw new PushUnsupported();
      if (lease.desired && agent.enabled && !pushTerminal(task.state)) {
        await this.gateway.register(agent, task, lease.id, this.credentials.callbackUrl(lease), this.credentials.token(lease), signal);
        await this.finish(lease, "active", null);
      } else {
        await this.gateway.remove(agent, task, lease.id, signal);
        await this.finish(lease, "deleted", null);
      }
    } catch (error) {
      const unsupported = error instanceof PushUnsupported;
      await this.finish(lease, unsupported ? "failed" : lease.desired ? "pending" : "deleting",
        unsupported ? "Agent does not support task push notifications." : shutdown.aborted ? null : "Push configuration unavailable; retry scheduled.",
        shutdown.aborted ? 0 : Math.min(30_000, 1000 * 2 ** Math.min(lease.attempts - 1, 5)));
    } finally { clearInterval(heartbeat); abort.abort(); }
    return true;
  }
  private finish(lease: PushRegistrationRecord, status: PushRegistrationRecord["status"], lastError: string | null, delay = 0) {
    const now = this.clock.now();
    return this.work.run((ports) => ports.push.finish(lease, now, { status, lastError, availableAt: new Date(now.getTime() + delay) }));
  }
}
