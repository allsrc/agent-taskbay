import type { Clock } from "../ports/clock";
import type { A2APushGateway, PushConfigSummary, PushCredentials, PushUnitOfWork } from "../ports/push";
import { PushUnsupported } from "../ports/push";
import type { PushRegistrationRecord } from "../../domain/persistence-model";

export const PUSH_LEASE_MS = 15_000;
export const PUSH_CLEANUP_INTERVAL_MS = 5 * 60_000;
export const PUSH_CLEANUP_RECHECK_MS = 24 * 60 * 60_000;
export const PUSH_CLEANUP_WINDOW_MS = 30 * 24 * 60 * 60_000;
export const PUSH_CLEANUP_BATCH = 50;
export const pushTerminal = (state: string) => ["COMPLETED", "FAILED", "CANCELED", "REJECTED"].includes(state.replace("TASK_STATE_", ""));

/**
 * Taskbay's own configuration: the id of a registration it issued for this task, or a callback URL under its own webhook path.
 * Anything else on the agent belongs to someone else and is never touched.
 */
export function isTaskbayPushConfig(config: PushConfigSummary, registrationIds: readonly string[], callbackPrefix: string) {
  return registrationIds.includes(config.id) || config.url.startsWith(callbackPrefix);
}

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
  /**
   * One cleanup pass for one agent: deletes configurations Taskbay left on the agent for finished tasks.
   * Returns the number deleted, or undefined when no agent was due. A shared database claim keeps it to one worker per agent per interval.
   */
  async cleanupOne(shutdown: AbortSignal): Promise<number | undefined> {
    const now = this.clock.now();
    const window = { since: new Date(now.getTime() - PUSH_CLEANUP_WINDOW_MS), recheckBefore: new Date(now.getTime() - PUSH_CLEANUP_RECHECK_MS) };
    const due = await this.work.run((ports) => ports.push.cleanupAgents(now, window, 20));
    for (const { organizationId, agentId } of due) {
      if (shutdown.aborted) return undefined;
      const batch = await this.work.run(async (ports) => {
        if (!await ports.push.claimCleanup(agentId, now, PUSH_CLEANUP_INTERVAL_MS)) return undefined;
        const agent = await ports.agents.findById(organizationId, agentId);
        const registrations = await ports.push.cleanupBatch(organizationId, agentId, now, window, PUSH_CLEANUP_BATCH);
        const tasks = new Map<string, Awaited<ReturnType<typeof ports.tasks.findById>>>();
        for (const registration of registrations) tasks.set(registration.id, await ports.tasks.findById(organizationId, registration.taskId));
        return { agent, registrations, tasks };
      });
      if (!batch) continue;
      const checked: string[] = [];
      let cleaned = 0;
      try {
        for (const registration of batch.registrations) {
          if (shutdown.aborted) break;
          const task = batch.tasks.get(registration.id);
          if (batch.agent?.enabled && task?.remoteTaskId) {
            const callback = this.credentials.callbackUrl(registration);
            const prefix = callback.slice(0, callback.length - registration.id.length);
            const configs = await this.gateway.list(batch.agent, task, shutdown);
            for (const config of configs.filter((entry) => isTaskbayPushConfig(entry, [registration.id], prefix))) {
              await this.gateway.remove(batch.agent, task, config.id, shutdown);
              cleaned++;
            }
          }
          checked.push(registration.id);
        }
      } catch { /* The agent is unreachable or refused; what was checked is recorded and the rest is tried at the next interval. */ }
      await this.work.run(async (ports) => {
        if (checked.length) await ports.push.markChecked(organizationId, checked, this.clock.now());
        if (cleaned) await ports.push.auditCleanup(organizationId, agentId, cleaned);
      });
      return cleaned;
    }
    return undefined;
  }
}
