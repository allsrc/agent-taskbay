import { randomUUID } from "node:crypto";
import { LockMode, type EntityManager, type FilterQuery } from "@mikro-orm/core";
import type { Principal } from "../../application/ports/identity";
import type { AccessGrant, AccessPolicyRepository } from "../../application/ports/security";
import { AccessPolicy } from "../../application/services/access-policy";
import { currentPrincipal } from "../auth/principal-context";
import { AccessGrantEntity, TeamEntity, TeamMembershipEntity, MembershipEntity, AgentEntity, TaskEntity, RateBucketEntity } from "./entities";
import { DatabaseIdentityRepository } from "./identity-repository";

export class DatabaseAccessPolicyRepository implements AccessPolicyRepository {
  constructor(private readonly em: EntityManager) {}
  async grantsFor(principal: Principal): Promise<AccessGrant[]> {
    const links = await this.em.find(TeamMembershipEntity, { membershipId: principal.membershipId });
    const teams = links.length ? await this.em.find(TeamEntity, { id: { $in: links.map((link) => link.teamId) },
      organizationId: principal.organizationId, enabled: true }) : [];
    const grants = await this.em.find(AccessGrantEntity, { organizationId: principal.organizationId, enabled: true,
      $or: [{ subjectType: "organization", subjectId: principal.organizationId },
        { subjectType: "membership", subjectId: principal.membershipId },
        { subjectType: "team", subjectId: { $in: teams.map((team) => team.id) } }] });
    return grants.filter((grant) => ["read", "operate"].includes(grant.permission)).map((grant) => ({ ...grant,
      skillId: grant.skillId ?? null, subjectType: grant.subjectType as AccessGrant["subjectType"], permission: grant.permission as AccessGrant["permission"] }));
  }
}

export async function requestAccessPolicy(em: EntityManager): Promise<AccessPolicy | undefined> {
  const principal = currentPrincipal();
  return principal ? new AccessPolicy(principal, await new DatabaseAccessPolicyRepository(em).grantsFor(principal)) : undefined;
}

/** Indexed typed task predicates apply before pagination/content loading. Workers have no human context. */
export async function taskAccessFilter(em: EntityManager): Promise<FilterQuery<TaskEntity>> {
  const policy = await requestAccessPolicy(em);
  if (!policy || policy.principal.role === "admin") return {};
  const conditions = policy.grants.map((grant) => ({ agentId: grant.agentId,
    ...(grant.skillId !== null ? { skillId: grant.skillId } : {}) }));
  return conditions.length ? { $or: conditions } : { id: { $in: [] } };
}

export async function createGrant(em: EntityManager, principal: Principal, input: Omit<AccessGrant, "id" | "organizationId" | "enabled">) {
  if (principal.role !== "admin") throw new Error("Administrator required.");
  if (!["read", "operate"].includes(input.permission) || !["organization", "membership", "team"].includes(input.subjectType) ||
    (input.skillId !== null && (!input.skillId || input.skillId.length > 255))) throw new Error("Invalid grant.");
  if (!await em.findOne(AgentEntity, {id: input.agentId, organizationId: principal.organizationId, enabled: true})) throw new Error("Unknown agent.");
  const valid = input.subjectType === "organization" ? input.subjectId === principal.organizationId :
    input.subjectType === "membership" ? Boolean(await em.findOne(MembershipEntity, { id: input.subjectId, organizationId: principal.organizationId, enabled: true })) :
      Boolean(await em.findOne(TeamEntity, { id: input.subjectId, organizationId: principal.organizationId, enabled: true }));
  if (!valid) throw new Error("Unknown grant subject.");
  const grant = em.create(AccessGrantEntity, { ...input, id: randomUUID(), organizationId: principal.organizationId, enabled: true });
  await em.flush();
  await new DatabaseIdentityRepository(em).appendAudit(principal, "access.granted", grant.id);
  return grant;
}

export class RateLimitError extends Error { readonly status = 429; constructor() { super("Too many requests. Try again shortly."); } }
export async function takeRateLimit(em: EntityManager, id: string, limit: number, now = new Date()) {
  return em.transactional(async (tx) => {
    await tx.upsert(RateBucketEntity, { id, count: 0, expiresAt: new Date(now.getTime() + 60_000) },
      { onConflictFields: ["id"], onConflictAction: "ignore" });
    const bucket = await tx.findOneOrFail(RateBucketEntity, {id}, {lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true});
    if (bucket.expiresAt <= now) { bucket.count = 0; bucket.expiresAt = new Date(now.getTime() + 60_000); }
    if (bucket.count >= limit) throw new RateLimitError();
    bucket.count += 1;
    await tx.flush();
  });
}
