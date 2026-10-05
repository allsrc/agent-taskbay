import type { MikroORM } from "@mikro-orm/core";
import { withJobEntityManager } from "../adapters/db/orm";
import { MikroOrmInboxRepository } from "../adapters/db/inbox-repository";
import { requestAccessPolicy } from "../adapters/db/security-repository";
import { AgentEntity, MembershipEntity, UserEntity } from "../adapters/db/entities";
import { InboxQueryService, type InboxRequest } from "../application/services/inbox-query";
import { requirePrincipal } from "./decisions";

/**
 * The caller's authorized inbox. Visibility mirrors task and approval access: administrators see the whole organization,
 * everyone else only agents and skills they hold a read grant for.
 */
export async function readInbox(request: InboxRequest, options: { orm?: MikroORM; now?: () => Date } = {}) {
  const principal = requirePrincipal();
  return withJobEntityManager(async (em) => {
    const policy = await requestAccessPolicy(em);
    const scope = !policy || policy.principal.role === "admin" ? undefined : policy.grants.map((grant) => ({ agentId: grant.agentId, skillId: grant.skillId }));
    const service = new InboxQueryService(new MikroOrmInboxRepository(em), {
      agents: async (organizationId, ids) => Object.fromEntries((ids.length ? await em.find(AgentEntity, { organizationId, id: { $in: ids } }) : [])
        .map((agent) => [agent.id, agent.displayName ?? agent.cardUrl])),
      people: async (organizationId, ids) => {
        const memberships = ids.length ? await em.find(MembershipEntity, { organizationId, id: { $in: ids } }) : [];
        const users = memberships.length ? await em.find(UserEntity, { id: { $in: memberships.map((membership) => membership.userId) } }) : [];
        return Object.fromEntries(memberships.flatMap((membership) => {
          const user = users.find((candidate) => candidate.id === membership.userId);
          return user ? [[membership.id, user.displayName]] : [];
        }));
      },
    }, { now: options.now ?? (() => new Date()) });
    return service.page({ organizationId: principal.organizationId, membershipId: principal.membershipId, scope }, request);
  }, options.orm);
}
