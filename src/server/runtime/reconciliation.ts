import type { MikroORM } from "@mikro-orm/core";
import type { ArtifactStore } from "../application/ports/artifact-store";
import type { A2AReconciliationGateway, ReconciliationUnitOfWork } from "../application/ports/reconciliation";
import { SYNC_LEASE_MS, terminalTask } from "../application/ports/reconciliation";
import { ReconciliationWorker, validateReconciledTask } from "../application/services/reconcile-task";
import { SdkReconciliationGateway } from "../adapters/a2a/reconciliation-gateway";
import { createPersistenceRepositories } from "../adapters/db/repositories";
import { withJobEntityManager } from "../adapters/db/orm";
import { createTaskObserver } from "./task-persistence";

class ConcurrentTaskUpdate extends Error {}
export function createReconciliationWorker(options: { orm?: MikroORM; store?: ArtifactStore; gateway?: A2AReconciliationGateway } = {}) {
  const work: ReconciliationUnitOfWork = { run: (callback) => withJobEntityManager((em) =>
    em.transactional((transaction) => callback(createPersistenceRepositories(transaction))), options.orm) };
  return new ReconciliationWorker(work, options.gateway ?? new SdkReconciliationGateway(), {
    ingest: async (cursor, task, event) => {
      try {
        await createTaskObserver({ organizationId: task.organizationId, agentId: task.agentId, tenant: task.tenant,
          sessionId: cursor.leaseOwner!, requestId: cursor.id, source: "reconcile" }, {
          orm: options.orm, store: options.store, manageSubscription: false,
          beforeObserve: async (transaction) => {
            const ports = createPersistenceRepositories(transaction);
            const locked = await ports.tasks.getOrCreate(task);
            if (locked.version !== task.version || terminalTask(locked.state)) throw new ConcurrentTaskUpdate();
            validateReconciledTask(event, locked);
            const timestamp = (event as { task: { status: { timestamp?: string } } }).task.status.timestamp;
            if (timestamp && locked.remoteUpdatedAt && Date.parse(timestamp) < locked.remoteUpdatedAt.getTime()) throw new ConcurrentTaskUpdate();
            if (!(await ports.agents.findById(task.organizationId, task.agentId))?.enabled) throw new Error("Agent disabled.");
            const now = new Date();
            if (!await ports.syncCursors.renew(cursor, now, new Date(now.getTime() + SYNC_LEASE_MS))) throw new Error("Read lease lost.");
          },
          onObserved: async (view, _event, transaction) => {
            const ports = createPersistenceRepositories(transaction);
            if (view.state !== task.state) {
              const current = await ports.tasks.findById(task.organizationId, task.id);
              if (current) await ports.subscriptions.sync(current, new Date());
            }
            if (cursor.taskId && terminalTask(view.state)) {
              const now = new Date();
              if (!await ports.syncCursors.finish(cursor, now, { status: "stopped", pageToken: "", lastError: null,
                availableAt: now, lastSyncedAt: now })) throw new Error("Read lease lost before commit.");
            }
          },
        })(event);
        return true;
      } catch (error) { if (error instanceof ConcurrentTaskUpdate) return false; throw error; }
    },
  });
}
