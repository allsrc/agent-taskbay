import type { EntityManager } from "@mikro-orm/core";
import type { OrganizationRole, Principal } from "../../application/ports/identity";
import { MembershipEntity, UserEntity, UserSessionEntity } from "./entities";
import { DatabaseIdentityRepository, provisionIdentity } from "./identity-repository";

export const ROLES: readonly OrganizationRole[] = ["admin", "operator", "viewer"];

/** A refusal the administrator can act on. The message is fixed text, never provider or database output. */
export class PeopleError extends Error {
  readonly status = 400;
  constructor(message: string) { super(message); this.name = "PeopleError"; }
}

async function member(tx: EntityManager, principal: Principal, membershipId: string) {
  const found = await tx.findOne(MembershipEntity, { id: membershipId, organizationId: principal.organizationId });
  if (!found) throw new PeopleError("Unknown person.");
  return found;
}

/**
 * Administrators cannot change or remove themselves. An administrator who is not the target is always left, so the
 * organization can never lose its last administrator through this screen.
 */
function notSelf(principal: Principal, target: MembershipEntity, what: string) {
  if (target.id === principal.membershipId) throw new PeopleError(`You can't ${what} yourself. Ask another administrator.`);
}

/** Add a person by their exact identity-provider subject, or change the role of one already provisioned. */
export async function provisionMember(tx: EntityManager, principal: Principal,
  input: { issuer: string; subject: string; displayName: string; role: OrganizationRole }) {
  if (!ROLES.includes(input.role)) throw new PeopleError("Choose a role.");
  const subject = input.subject.trim(), displayName = input.displayName.trim();
  if (!subject || subject.length > 255) throw new PeopleError("Enter the person's identity-provider subject (up to 255 characters).");
  if (!displayName || displayName.length > 200) throw new PeopleError("Enter a name (up to 200 characters).");
  const created = await provisionIdentity(tx, { issuer: input.issuer, subject, displayName, role: input.role, organizationId: principal.organizationId });
  await new DatabaseIdentityRepository(tx).appendAudit(principal, "member.provisioned", created.membershipId);
  return created.membershipId;
}

export async function changeMemberRole(tx: EntityManager, principal: Principal, input: { membershipId: string; role: OrganizationRole }) {
  if (!ROLES.includes(input.role)) throw new PeopleError("Choose a role.");
  const target = await member(tx, principal, input.membershipId);
  notSelf(principal, target, "change the role of");
  if (target.role === input.role) return;
  target.role = input.role;
  await tx.flush();
  await new DatabaseIdentityRepository(tx).appendAudit(principal, "member.role_changed", target.id);
}

/** Turn off a membership. Their sessions end now; their tasks, approvals and audit entries stay. */
export async function deactivateMember(tx: EntityManager, principal: Principal, membershipId: string) {
  const target = await member(tx, principal, membershipId);
  notSelf(principal, target, "deactivate");
  target.enabled = false;
  await tx.nativeDelete(UserSessionEntity, { membershipId: target.id });
  await tx.flush();
  await new DatabaseIdentityRepository(tx).appendAudit(principal, "member.deactivated", target.id);
}

export async function reactivateMember(tx: EntityManager, principal: Principal, membershipId: string) {
  const target = await member(tx, principal, membershipId);
  const user = await tx.findOne(UserEntity, { id: target.userId });
  if (!user?.enabled) throw new PeopleError("This person's account is disabled on the server, so they can't be reactivated here.");
  target.enabled = true;
  await tx.flush();
  await new DatabaseIdentityRepository(tx).appendAudit(principal, "member.reactivated", target.id);
}
