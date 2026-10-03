import type { Clock } from "../ports/clock";
import type { A2AReconciliationGateway, ReconciliationSink, ReconciliationUnitOfWork } from "../ports/reconciliation";
import { ListTasksUnsupported, SYNC_LEASE_MS } from "../ports/reconciliation";
import type { JsonValue, SyncCursorRecord, TaskRecord } from "../../domain/persistence-model";
import { eventSubject } from "./task-projection";

export function validateReconciledTask(event: JsonValue, task: TaskRecord) {
  const { kind, subject, remoteTaskId } = eventSubject(event);
  if (kind !== "task" || remoteTaskId !== task.remoteTaskId ||
    subject.tenant !== undefined && subject.tenant !== task.tenant ||
    task.remoteContextId && subject.contextId !== task.remoteContextId) throw new Error("Unexpected reconciliation identity.");
  if (!subject.status || typeof subject.status !== "object" || !('state' in subject.status)) throw new Error("Invalid task snapshot.");
}

export class ReconciliationWorker {
  constructor(private readonly work: ReconciliationUnitOfWork, private readonly gateway: A2AReconciliationGateway,
    private readonly sink: ReconciliationSink, private readonly clock: Clock = { now: () => new Date() }) {}
  async runOne(owner: string, shutdown: AbortSignal): Promise<boolean> {
    const now = this.clock.now();
    const cursor = await this.work.run((ports) => ports.syncCursors.claim(owner, now, new Date(now.getTime() + SYNC_LEASE_MS)));
    if (!cursor) return false;
    const controller = new AbortController();
    const signal = AbortSignal.any([shutdown, controller.signal]);
    let renewing = false;
    const heartbeat = setInterval(() => {
      if (renewing) return;
      renewing = true;
      const time = this.clock.now();
      void this.work.run((ports) => ports.syncCursors.renew(cursor, time, new Date(time.getTime() + SYNC_LEASE_MS)))
        .then((owned) => { if (!owned) controller.abort(); }, () => controller.abort()).finally(() => { renewing = false; });
    }, SYNC_LEASE_MS / 3);
    heartbeat.unref?.();
    try {
      const agent = await this.work.run((ports) => ports.agents.findById(cursor.organizationId, cursor.agentId));
      if (!agent?.enabled) { await this.finish(cursor, "stopped", "Agent is unavailable or disabled."); return true; }
      const tasks = await this.work.run((ports) => ports.syncCursors.knownTasks(cursor));
      if (cursor.taskId) {
        const task = tasks.find((task) => task.id === cursor.taskId);
        if (!task?.remoteTaskId) { await this.finish(cursor, "stopped", null); return true; }
        const event = await this.gateway.get(agent, task, signal);
        if (signal.aborted) throw new Error("Read aborted.");
        validateReconciledTask(event, task);
        await this.sink.ingest(cursor, task, event);
        await this.finish(cursor, "pending", null, 15_000, "", this.clock.now());
      } else {
        const page = await this.gateway.list(agent, cursor, signal);
        if (signal.aborted) throw new Error("Read aborted.");
        if (page.nextPageToken.length > 4096 || page.nextPageToken && page.nextPageToken === cursor.pageToken || page.tasks.length > 100)
          throw new Error("Invalid pagination.");
        // Validate the entire known page before ingesting any of it.
        const known = new Map(tasks.map((task) => [task.remoteTaskId, task]));
        const observations = page.tasks.flatMap((event) => {
          const task = known.get(eventSubject(event).remoteTaskId);
          if (!task) return [];
          validateReconciledTask(event, task);
          return [{ task, event }];
        });
        for (const { task, event } of observations) {
          if (signal.aborted) throw new Error("Read aborted.");
          await this.sink.ingest(cursor, task, event);
        }
        await this.finish(cursor, "pending", null, page.nextPageToken ? 0 : 60_000, page.nextPageToken, this.clock.now());
      }
    } catch (error) {
      const unsupported = !cursor.taskId && error instanceof ListTasksUnsupported;
      // Neither error strings nor remote results enter operational state.
      await this.finish(cursor, unsupported ? "unsupported" : "pending",
        shutdown.aborted ? null : unsupported ? "Agent does not support task listing; GetTask polling remains active." : "Task reconciliation unavailable; read retry scheduled.",
        shutdown.aborted ? 0 : Math.min(60_000, 1000 * 2 ** Math.min(cursor.attempts - 1, 6)), "");
    } finally { clearInterval(heartbeat); controller.abort(); }
    return true;
  }
  private finish(cursor: SyncCursorRecord, status: SyncCursorRecord["status"], lastError: string | null, delay = 0,
    pageToken = cursor.pageToken, lastSyncedAt = cursor.lastSyncedAt) {
    const now = this.clock.now();
    return this.work.run((ports) => ports.syncCursors.finish(cursor, now, {
      status, lastError, pageToken, lastSyncedAt, availableAt: new Date(now.getTime() + delay),
    }));
  }
}
