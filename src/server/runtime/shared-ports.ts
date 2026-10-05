import type { EntityManager } from "@mikro-orm/core";
import { MembershipEntity, UserEntity } from "../adapters/db/entities";
import { DatabaseIdentityRepository } from "../adapters/db/identity-repository";
import { DatabaseAccessPolicyRepository, requestAccessPolicy } from "../adapters/db/security-repository";
import { createPersistenceRepositories } from "../adapters/db/repositories";
import { AccessPolicy } from "../application/services/access-policy";
import { enqueueTaskFreshness } from "../application/services/task-freshness";
import type { Principal } from "../application/ports/identity";

/** Access, audit and freshness behavior shared by the approval and workflow units of work. */
export function sharedPorts(em: EntityManager) {
  const base = createPersistenceRepositories(em);
  const identity = new DatabaseIdentityRepository(em);
  return {
    tasks: base.tasks, commands: base.commands, outbox: base.outbox,
    requireOperate: async (principal: Principal, agentId: string, skillId: string | null) => {
      const policy = await requestAccessPolicy(em);
      (policy ?? new AccessPolicy(principal, [])).require(agentId, "operate", skillId);
    },
    canRead: async (principal: Principal, agentId: string, skillId: string | null) => {
      const policy = await requestAccessPolicy(em);
      return (policy ?? new AccessPolicy(principal, [])).allows(agentId, "read", skillId);
    },
    canOperate: async (organizationId: string, membershipId: string, agentId: string, skillId: string | null) => {
      const membership = await em.findOne(MembershipEntity, { id: membershipId, organizationId, enabled: true }, { refresh: true });
      const user = membership && await em.findOne(UserEntity, { id: membership.userId, enabled: true }, { refresh: true });
      if (!membership || !user || !["admin", "operator"].includes(membership.role)) return false;
      const principal: Principal = { userId: user.id, organizationId, membershipId, displayName: user.displayName, role: membership.role as Principal["role"] };
      return new AccessPolicy(principal, await new DatabaseAccessPolicyRepository(em).grantsFor(principal)).allows(agentId, "operate", skillId);
    },
    isReviewer: async (organizationId: string, membershipId: string) => {
      const membership = await em.findOne(MembershipEntity, { id: membershipId, organizationId, enabled: true }, { refresh: true });
      const user = membership && await em.findOne(UserEntity, { id: membership.userId, enabled: true }, { refresh: true });
      return Boolean(membership && user && ["admin", "operator"].includes(membership.role));
    },
    freshen: async (organizationId: string, taskId: string) => { await enqueueTaskFreshness(base.outbox, organizationId, taskId, new Date()); },
    audit: async (principal: Principal | null, organizationId: string, action: string, targetId: string, eventKey: string) => {
      if (principal) await identity.appendAudit(principal, action, targetId, eventKey);
      else await identity.appendSystemAudit(organizationId, action, targetId);
    },
  };
}
