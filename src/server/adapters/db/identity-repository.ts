import { randomUUID } from "node:crypto";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import type { IdentityRepository, OrganizationRole, Principal } from "../../application/ports/identity";
import { AuthenticationError } from "../../application/services/authorization";
import { UserEntity, ExternalIdentityEntity, MembershipEntity, UserSessionEntity, LoginAttemptEntity,
  SecurityAuditEntity, OrganizationEntity } from "./entities";

export class DatabaseIdentityRepository implements IdentityRepository {
  constructor(private readonly em: EntityManager) {}
  private async principal(membershipId: string): Promise<Principal | undefined> {
    const membership = await this.em.findOne(MembershipEntity, { id: membershipId, enabled: true }, { refresh: true });
    if (!membership || !["admin", "operator", "viewer"].includes(membership.role)) return;
    const user = await this.em.findOne(UserEntity, { id: membership.userId, enabled: true }, { refresh: true });
    if (!user) return;
    return { userId: user.id, displayName: user.displayName, membershipId: membership.id,
      organizationId: membership.organizationId, role: membership.role as OrganizationRole };
  }
  async resolveExternal(issuer: string, subject: string, organizationSlug: string) {
    const identity = await this.em.findOne(ExternalIdentityEntity, { issuer, subject });
    const org = await this.em.findOne(OrganizationEntity, { slug: organizationSlug });
    if (!identity || !org) return;
    const membership = await this.em.findOne(MembershipEntity, { organizationId: org.id, userId: identity.userId, enabled: true });
    return membership ? this.principal(membership.id) : undefined;
  }
  async resolveSession(hash: string, now: Date) {
    const session = await this.em.findOne(UserSessionEntity, { tokenHash: hash, expiresAt: { $gt: now } }, { refresh: true });
    return session ? this.principal(session.membershipId) : undefined;
  }
  async createSession(hash: string, principal: Principal, expiresAt: Date) {
    const current = await this.principal(principal.membershipId);
    if (!current || current.organizationId !== principal.organizationId || current.userId !== principal.userId) throw new AuthenticationError();
    this.em.create(UserSessionEntity, { tokenHash: hash, membershipId: principal.membershipId, expiresAt, createdAt: new Date() });
    await this.em.flush();
  }
  async revokeSession(hash: string) { await this.em.nativeDelete(UserSessionEntity, { tokenHash: hash }); }
  async saveLogin(hash: string, encryptedFlow: string, expiresAt: Date) {
    // Bounded retention without a separate maintenance service for this first adapter.
    await this.em.nativeDelete(LoginAttemptEntity, { expiresAt: { $lte: new Date() } });
    await this.em.nativeDelete(UserSessionEntity, { expiresAt: { $lte: new Date() } });
    this.em.create(LoginAttemptEntity, { tokenHash: hash, encryptedFlow, expiresAt });
    await this.em.flush();
  }
  async consumeLogin(hash: string, now: Date) {
    return this.em.transactional(async (tx) => {
      const flow = await tx.findOne(LoginAttemptEntity, { tokenHash: hash }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!flow) return;
      await tx.nativeDelete(LoginAttemptEntity, { tokenHash: hash });
      return flow.expiresAt > now ? flow.encryptedFlow : undefined;
    });
  }
  async appendAudit(principal: Principal, action: string, targetId: string, eventKey: string = randomUUID()) {
    // Fixed facts only, never arbitrary request bodies, provider claims or exception messages.
    await this.em.upsert(SecurityAuditEntity, { id: randomUUID(), organizationId: principal.organizationId,
      actorUserId: principal.userId, actorType: "user", action, targetId, eventKey, createdAt: new Date() },
    { onConflictFields: ["eventKey"], onConflictAction: "ignore" });
  }
  /** A fact caused by an agent (for example the request it opened); deterministic key so a replay writes it once. */
  async appendAgentAudit(organizationId: string, action: string, targetId: string, eventKey: string) {
    await this.em.upsert(SecurityAuditEntity, { id: randomUUID(), organizationId, actorUserId: null, actorType: "agent", action, targetId, eventKey, createdAt: new Date() },
      { onConflictFields: ["eventKey"], onConflictAction: "ignore" });
  }
  async appendSystemAudit(organizationId: string, action: string, targetId: string) {
    this.em.create(SecurityAuditEntity, { id: randomUUID(), organizationId, actorUserId: null, actorType: "system",
      action, targetId, eventKey: randomUUID(), createdAt: new Date() });
    await this.em.flush();
  }
}

/** Operator-controlled provisioning, never driven by a browser or IdP role/tenant claim. */
export async function provisionIdentity(em: EntityManager, input: {
  issuer: string; subject: string; organizationId: string; displayName: string; role: OrganizationRole;
}) {
  if (!input.issuer || input.issuer.length > 1024 || !input.subject || input.subject.length > 255 ||
    !input.displayName || input.displayName.length > 200 || !["admin", "operator", "viewer"].includes(input.role)) throw new Error("Invalid identity provisioning input.");
  return em.transactional(async (tx) => {
    const identity = await tx.upsert(ExternalIdentityEntity,
      { id: randomUUID(), userId: await userForIdentity(tx, input), issuer: input.issuer, subject: input.subject },
      { onConflictFields: ["issuer", "subject"], onConflictAction: "ignore" });
    await tx.upsert(MembershipEntity, { id: randomUUID(), organizationId: input.organizationId,
      userId: identity.userId, role: input.role, enabled: true },
    { onConflictFields: ["organizationId", "userId"], onConflictMergeFields: ["role", "enabled"] });
    const membership = await tx.findOneOrFail(MembershipEntity, { organizationId: input.organizationId, userId: identity.userId });
    const org = await tx.findOneOrFail(OrganizationEntity, { id: input.organizationId });
    const principal = (await new DatabaseIdentityRepository(tx).resolveExternal(input.issuer, input.subject, org.slug))!;
    await new DatabaseIdentityRepository(tx).appendSystemAudit(input.organizationId, "identity.provisioned", membership.id);
    return principal;
  });
}

async function userForIdentity(em: EntityManager, input: { issuer: string; subject: string; displayName: string }) {
  // Transaction advisory lock serializes provisioning of the same issuer/subject across replicas.
  await em.getConnection().execute("select pg_advisory_xact_lock(hashtext(?))", [JSON.stringify([input.issuer, input.subject])], "all", em.getTransactionContext());
  const existing = await em.findOne(ExternalIdentityEntity, { issuer: input.issuer, subject: input.subject });
  if (existing) return existing.userId;
  const user = em.create(UserEntity, { id: randomUUID(), displayName: input.displayName, enabled: true, createdAt: new Date() });
  await em.flush();
  return user.id;
}
