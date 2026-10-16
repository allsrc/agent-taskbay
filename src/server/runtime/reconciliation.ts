import type { MikroORM } from "@mikro-orm/core";
import type { ArtifactStore } from "../application/ports/artifact-store";
import type { A2AReconciliationGateway, ReconciliationUnitOfWork } from "../application/ports/reconciliation";
import { SYNC_LEASE_MS, terminalTask } from "../application/ports/reconciliation";
import { ReconciliationWorker, validateReconciledTask } from "../application/services/reconcile-task";
import { SdkReconciliationGateway } from "../adapters/a2a/reconciliation-gateway";
import { createPersistenceRepositories } from "../adapters/db/repositories";
import { withJobEntityManager } from "../adapters/db/orm";
import { createTaskObserver } from "./task-persistence";
import { DatabaseIdentityRepository } from "../adapters/db/identity-repository";
import { effectiveTaskDiscovery, DEFAULT_TASK_DISCOVERY_MODE } from "../domain/discovery-mode";
import { taskDiscoveryCap } from "./runtime-config";
import { cardDefaultTenant } from "../../lib/connection-interface";
import { eventSubject } from "../application/services/task-projection";

/** What mode an agent is in now: its own setting under the deployment cap, read each time so a change takes effect without a restart. */
export const discoveryPolicy = () => ({ mode: (agent: { taskDiscovery?: "off" | "browse" | "auto" }) => effectiveTaskDiscovery(agent.taskDiscovery ?? DEFAULT_TASK_DISCOVERY_MODE, taskDiscoveryCap()) });

class ConcurrentTaskUpdate extends Error {}
class ExistingLegacyTask extends Error {}
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
    // Automatic discovery: a task found on the agent is stored by no one in particular, under the same lease fence as any read.
    discover: async (cursor, event) => {
      try {
        await createTaskObserver({ organizationId: cursor.organizationId, agentId: cursor.agentId, tenant: cursor.tenant,
          sessionId: cursor.leaseOwner!, requestId: cursor.id, source: "reconcile", origin: "discovered", trackedByUserId: null }, {
          orm: options.orm, store: options.store,
          beforeObserve: async (transaction) => {
            const ports = createPersistenceRepositories(transaction);
            const agent = await ports.agents.findById(cursor.organizationId, cursor.agentId);
            if (!agent?.enabled) throw new Error("Agent disabled.");
            const snapshot = cursor.tenant ? await ports.agents.findLatestCardSnapshot(cursor.agentId) : undefined;
            const remoteTaskId = eventSubject(event).remoteTaskId;
            if (cursor.tenant && cardDefaultTenant(snapshot?.normalizedCardJson) === cursor.tenant && remoteTaskId &&
              await ports.tasks.findByRemoteIdentity({ organizationId: cursor.organizationId, agentId: cursor.agentId, tenant: "", remoteTaskId }))
              throw new ExistingLegacyTask();
            const now = new Date();
            if (!await ports.syncCursors.renew(cursor, now, new Date(now.getTime() + SYNC_LEASE_MS))) throw new Error("Read lease lost.");
          },
        })(event);
        return true;
      } catch (error) { if (error instanceof ExistingLegacyTask) return false; throw error; }
    },
    report: async (cursor) => {
      await withJobEntityManager((em) => new DatabaseIdentityRepository(em).appendSystemAudit(cursor.organizationId, "task.discovery.found", cursor.agentId), options.orm);
    },
    pause: async (cursor, reason) => {
      await withJobEntityManager((em) => em.transactional(async (transaction) => {
        await createPersistenceRepositories(transaction).agents.setTaskDiscovery(cursor.organizationId, cursor.agentId, { taskDiscoveryPausedReason: reason }, new Date());
        await new DatabaseIdentityRepository(transaction).appendSystemAudit(cursor.organizationId, "task.discovery.paused", cursor.agentId);
      }), options.orm);
    },
  }, undefined, discoveryPolicy());
}
