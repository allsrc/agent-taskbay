import { requestAccessPolicy } from "../adapters/db/security-repository";
import type { MikroORM } from "@mikro-orm/core";
import type { ArtifactStore } from "../application/ports/artifact-store";
import type { A2ASubscriptionGateway, SubscriptionUnitOfWork } from "../application/ports/subscriptions";
import { SubscriptionWorker } from "../application/services/observe-subscription";
import { observationPaused, SUBSCRIPTION_LEASE_MS } from "../application/services/subscription-state";
import { SdkSubscriptionGateway } from "../adapters/a2a/subscription-gateway";
import { createPersistenceRepositories } from "../adapters/db/repositories";
import { withJobEntityManager, withRequestEntityManager } from "../adapters/db/orm";
import { bootstrapDefaultLocalOrganization } from "../application/services/bootstrap-default-organization";
import { createTaskObserver } from "./task-persistence";
import { CommandError } from "../application/services/task-command";
import { TaskQueryService } from "../application/services/task-query";
import { currentPrincipal } from "../adapters/auth/principal-context";
import { authorize } from "../application/services/authorization";

export function createSubscriptionWorker(options: { orm?: MikroORM; store?: ArtifactStore; gateway?: A2ASubscriptionGateway } = {}) {
  const work: SubscriptionUnitOfWork = { run: (callback) => withJobEntityManager((em) =>
    em.transactional((transaction) => callback(createPersistenceRepositories(transaction))), options.orm) };
  return new SubscriptionWorker(work, options.gateway ?? new SdkSubscriptionGateway(), {
    open: (lease, task, streamMetadata) => {
      let paused = false;
      const observer = createTaskObserver({ organizationId: task.organizationId, agentId: task.agentId, tenant: task.tenant,
        sessionId: lease.leaseOwner!, requestId: lease.id, source: "stream", streamMetadata }, {
        orm: options.orm, store: options.store, manageSubscription: false,
        onObserved: async (view, _event, transaction) => {
          const ports = createPersistenceRepositories(transaction);
          const now = new Date();
          paused = observationPaused(view.state);
          const owned = paused
            ? await ports.subscriptions.finish(lease, now, { status: "stopped", lastError: null, availableAt: now })
            : await ports.subscriptions.renew(lease, now, new Date(now.getTime() + SUBSCRIPTION_LEASE_MS));
          if (!owned) throw new Error("Subscription lease lost before ingestion commit.");
        },
      });
      return async (event) => { await observer(event); return paused; };
    },
  });
}

/** Explicit browser reconnect only resolves a known durable, scoped task. */
export async function ensureTaskSubscription(agentId: string, tenant: string, remoteTaskId: string) {
  return withRequestEntityManager(async (em) => {
    const principal = currentPrincipal();
    if (principal) authorize(principal, "operate");
    const organizations = createPersistenceRepositories(em).organizations;
    const org = principal ? await organizations.findById(principal.organizationId) : await bootstrapDefaultLocalOrganization(organizations);
    if (!org) throw new CommandError("Unknown organization.", 404);
    return em.transactional(async (transaction) => {
      const ports = createPersistenceRepositories(transaction);
      const task = await ports.tasks.findByRemoteIdentity({ organizationId: org.id, agentId, tenant, remoteTaskId });
      if (!task) throw new CommandError("No observed task in this agent and tenant scope.", 404);
      (await requestAccessPolicy(transaction))?.require(task.agentId, "operate", task.skillId ?? null);
      // Use the same task -> subscription lock order as ingestion.
      const locked = await ports.tasks.getOrCreate(task);
      await ports.subscriptions.sync(locked, new Date());
      return locked.id;
    });
  });
}

export async function readTaskFeed(localId: string, after: number) {
  return withRequestEntityManager(async (em) => {
    const ports = createPersistenceRepositories(em);
    const principal = currentPrincipal();
    const org = principal ? await ports.organizations.findById(principal.organizationId) : await bootstrapDefaultLocalOrganization(ports.organizations);
    if (!org) throw new CommandError("Unknown organization.", 404);
    const task = await ports.tasks.findById(org.id, localId);
    if (!task) throw new CommandError("Task not found.", 404);
    return { task, events: await ports.taskEvents.readFeed(org.id, localId, after, 100),
      view: await new TaskQueryService(ports.tasks, ports.agents).detail(org.id, localId),
      subscription: await ports.subscriptions.findByTaskId(org.id, localId) };
  });
}
