import type { EntityManager } from "@mikro-orm/core";
import { AgentEntity, MembershipEntity, TaskEntity, UserEntity } from "../adapters/db/entities";
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
    names: async (organizationId: string, userIds: string[], membershipIds: string[]) => {
      const memberships = membershipIds.length ? await em.find(MembershipEntity, { organizationId, id: { $in: [...new Set(membershipIds)] } }) : [];
      const memberUsers = memberships.map((membership) => membership.userId);
      // Only people with a membership in this organization are named.
      const inOrg = new Set((userIds.length ? await em.find(MembershipEntity, { organizationId, userId: { $in: [...new Set(userIds)] } }) : []).map((membership) => membership.userId));
      const ids = [...new Set([...memberUsers, ...inOrg])];
      const users = ids.length ? await em.find(UserEntity, { id: { $in: ids } }) : [];
      const people: Record<string, string> = {};
      for (const user of users) if (inOrg.has(user.id)) people[user.id] = user.displayName;
      for (const membership of memberships) { const user = users.find((candidate) => candidate.id === membership.userId); if (user) people[membership.id] = user.displayName; }
      return people;
    },
    taskContext: async (organizationId: string, taskIds: string[]) => {
      const ids = [...new Set(taskIds)];
      const tasks = ids.length ? await em.find(TaskEntity, { organizationId, id: { $in: ids } }, { fields: ["id", "agentId", "title", "state"] }) : [];
      const agentIds = [...new Set(tasks.map((task) => task.agentId))];
      const agents = agentIds.length ? await em.find(AgentEntity, { organizationId, id: { $in: agentIds } }) : [];
      return Object.fromEntries(tasks.map((task) => [task.id, { title: task.title ?? null, state: task.state,
        agentName: agents.find((agent) => agent.id === task.agentId)?.displayName ?? agents.find((agent) => agent.id === task.agentId)?.cardUrl ?? "Agent" }]));
    },
    freshen: async (organizationId: string, taskId: string) => { await enqueueTaskFreshness(base.outbox, organizationId, taskId, new Date()); },
    audit: async (principal: Principal | null, organizationId: string, action: string, targetId: string, eventKey: string) => {
      if (principal) await identity.appendAudit(principal, action, targetId, eventKey);
      else await identity.appendSystemAudit(organizationId, action, targetId);
    },
  };
}
