import type { EntityManager, MikroORM } from "@mikro-orm/core";
import { withJobEntityManager } from "../adapters/db/orm";
import { AgentEntity } from "../adapters/db/entities";
import { createPersistenceRepositories } from "../adapters/db/repositories";
import { effectiveTaskDiscovery, DEFAULT_TASK_DISCOVERY_MODE } from "../domain/discovery-mode";
import { taskDiscoveryCap } from "./runtime-config";
import { advertisedTenants, cardInterfaces } from "../../lib/connection-interface";

/** Tenants an agent's card declares for its interfaces. */
function cardTenants(card: unknown): string[] {
  return advertisedTenants(cardInterfaces(card)).filter((tenant) => tenant.length <= 255);
}

/**
 * Makes sure an agent in automatic mode has a list cursor per tenant: the default tenant, those its card declares and those of tasks already stored.
 * `reset` also restarts cursors that were stopped or found unsupported; use it when someone switches the mode on.
 */
export async function startAutomaticDiscovery(em: EntityManager, organizationId: string, agentId: string, reset: boolean) {
  const ports = createPersistenceRepositories(em);
  const snapshot = await ports.agents.findLatestCardSnapshot(agentId);
  const declared = cardTenants(snapshot?.normalizedCardJson);
  const tenants = [...(declared.length ? declared : [""]), ...await ports.syncCursors.taskTenants(organizationId, agentId)];
  await ports.syncCursors.startDiscovery(organizationId, agentId, tenants, new Date(), reset);
}

/** For one agent: start cursors if it is in automatic mode under the deployment's cap. Cheap, and safe to call often. */
export async function ensureDiscoveryCursorsFor(agentId: string, orm?: MikroORM) {
  await withJobEntityManager(async (em) => {
    const agent = await em.findOne(AgentEntity, { id: agentId, enabled: true });
    if (agent && effectiveTaskDiscovery(agent.taskDiscovery ?? DEFAULT_TASK_DISCOVERY_MODE, taskDiscoveryCap()) === "auto") await em.transactional((tx) => startAutomaticDiscovery(tx, agent.organizationId, agent.id, false));
  }, orm);
}

/** At worker start: every enabled agent in automatic mode, in every organization. */
export async function ensureAutomaticDiscoveryCursors(orm?: MikroORM) {
  if (effectiveTaskDiscovery("auto", taskDiscoveryCap()) !== "auto") return;
  await withJobEntityManager(async (em) => {
    for (const agent of await em.find(AgentEntity, { enabled: true, taskDiscovery: "auto" })) await em.transactional((tx) => startAutomaticDiscovery(tx, agent.organizationId, agent.id, false));
  }, orm);
}
