import { z } from "zod";
import { authenticatedRoute } from "@/server/runtime/identity";
import { currentPrincipal } from "@/server/adapters/auth/principal-context";
import { withRequestEntityManager } from "@/server/adapters/db/orm";
import { TeamEntity, TeamMembershipEntity, MembershipEntity, UserEntity, AccessGrantEntity, AgentCredentialEntity } from "@/server/adapters/db/entities";
import { DatabaseIdentityRepository } from "@/server/adapters/db/identity-repository";
import { createGrant } from "@/server/adapters/db/security-repository";
import { readJsonRequest } from "@/lib/request-guard";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = z.string().uuid();
const mutation = z.discriminatedUnion("action", [
  z.object({action: z.literal("createTeam"), name: z.string().trim().min(1).max(200)}).strict(),
  z.object({action: z.enum(["addTeamMember", "removeTeamMember"]), teamId: uuid, membershipId: uuid}).strict(),
  z.object({action: z.literal("disableTeam"), teamId: uuid}).strict(),
  z.object({action: z.literal("grant"), agentId: uuid, skillId: z.string().min(1).max(255).nullable(),
    subjectType: z.enum(["organization", "membership", "team"]), subjectId: uuid, permission: z.enum(["read", "operate"])}).strict(),
  z.object({action: z.literal("revokeGrant"), grantId: uuid}).strict(),
]);
async function handleGET() {
  const principal = currentPrincipal()!;
  return withRequestEntityManager(async (em) => {
    const teams = await em.find(TeamEntity, {organizationId: principal.organizationId});
    const memberships = await em.find(MembershipEntity, {organizationId: principal.organizationId, enabled: true});
    const users = memberships.length ? await em.find(UserEntity, {id: {$in: memberships.map((member) => member.userId)}, enabled: true}) : [];
    const grants = await em.find(AccessGrantEntity, {organizationId: principal.organizationId});
    const credentials = await em.find(AgentCredentialEntity, {organizationId: principal.organizationId}, {fields: ["agentId", "kind", "enabled", "updatedAt"]});
    const teamMembers = teams.length ? await em.find(TeamMembershipEntity, {teamId: {$in: teams.map((team) => team.id)}}) : [];
    return Response.json({ organizationId: principal.organizationId, teams: teams.map(({id,name,enabled}) => ({id,name,enabled})),
      memberships: memberships.filter((member) => users.some((user) => user.id === member.userId)).map((member) => ({id: member.id, role: member.role,
        name: users.find((user) => user.id === member.userId)!.displayName})),
      teamMembers: teamMembers.map(({id,teamId,membershipId}) => ({id,teamId,membershipId})),
      grants: grants.map(({id,agentId,skillId,subjectType,subjectId,permission,enabled}) => ({id,agentId,skillId,subjectType,subjectId,permission,enabled})),
      credentials: credentials.map(({agentId,kind,enabled,updatedAt}) => ({agentId,kind,enabled,updatedAt})) }, {headers: {"Cache-Control": "no-store"}});
  });
}
async function handlePOST(request: Request) {
  try {
    const parsed = mutation.safeParse(await readJsonRequest(request));
    if (!parsed.success) return Response.json({error: {message: "Invalid access management request."}}, {status: 400});
    const input = parsed.data;
    const principal = currentPrincipal()!;
    await withRequestEntityManager((em) => em.transactional(async (tx) => {
      if (input.action === "grant") { const {action: _action, ...grant} = input; void _action; await createGrant(tx, principal, grant); return; }
      if (input.action === "revokeGrant") {
        const grant = await tx.findOne(AccessGrantEntity, {id: input.grantId, organizationId: principal.organizationId});
        if (!grant) throw new Error("Unknown grant.");
        grant.enabled = false; await tx.flush();
        await new DatabaseIdentityRepository(tx).appendAudit(principal, "access.revoked", grant.id); return;
      }
      if (input.action === "createTeam") {
        const team = tx.create(TeamEntity, {id: crypto.randomUUID(), organizationId: principal.organizationId, name: input.name, enabled: true});
        await tx.flush(); await new DatabaseIdentityRepository(tx).appendAudit(principal, "team.created", team.id); return;
      }
      const team = await tx.findOne(TeamEntity, {id: input.teamId, organizationId: principal.organizationId, enabled: true});
      if (!team) throw new Error("Unknown team.");
      if (input.action === "disableTeam") { team.enabled = false; await tx.flush(); }
      else {
        if (!await tx.findOne(MembershipEntity, {id: input.membershipId, organizationId: principal.organizationId, enabled: true})) throw new Error("Unknown membership.");
        if (input.action === "addTeamMember") await tx.upsert(TeamMembershipEntity,
          {id: crypto.randomUUID(), teamId: team.id, membershipId: input.membershipId}, {onConflictFields: ["teamId", "membershipId"], onConflictAction: "ignore"});
        else await tx.nativeDelete(TeamMembershipEntity, {teamId: team.id, membershipId: input.membershipId});
      }
      await new DatabaseIdentityRepository(tx).appendAudit(principal, `team.${input.action}`, team.id);
    }));
    return Response.json({updated: true}, {headers: {"Cache-Control": "no-store"}});
  } catch (error) { return apiError(error, 400); }
}
export const GET = authenticatedRoute("administer", handleGET);
export const POST = authenticatedRoute("administer", handlePOST);
