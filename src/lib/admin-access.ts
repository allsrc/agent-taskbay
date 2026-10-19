/** Shapes returned by `GET /api/admin/security`, and the pure reading of them the Admin screens share. */
export interface SecurityView {
  organizationId: string;
  teams: Array<{ id: string; name: string; enabled: boolean }>;
  memberships: Array<{ id: string; name: string; role: string }>;
  teamMembers: Array<{ id: string; teamId: string; membershipId: string }>;
  grants: Array<{ id: string; subjectType: string; subjectId: string; agentId: string; skillId: string | null; permission: string; enabled: boolean }>;
  credentials: Array<{ agentId: string; kind: string; enabled: boolean; updatedAt: string }>;
}

export type Grant = SecurityView["grants"][number];

/** Why a person holds a grant: given to everyone, to one of their teams, or to them directly. */
export interface EffectiveGrant extends Grant {
  via: "organization" | "team" | "person";
  /** The team's name when `via` is "team". */
  teamName?: string;
}

export const ROLE_ORDER = ["admin", "operator", "viewer"] as const;

export const ROLE_HELP: Record<string, string> = {
  admin: "Manages the organization and reaches every agent.",
  operator: "Works with the agents they are granted: read, and send, answer or cancel with an operate grant.",
  viewer: "Reads the agents they are granted. Cannot send, answer or cancel.",
};

/** The enabled grants that apply to one person, through the organization, their teams and their own membership. */
export function effectiveGrants(view: SecurityView, membershipId: string): EffectiveGrant[] {
  const teams = new Map(
    view.teamMembers.filter((link) => link.membershipId === membershipId)
      .map((link) => view.teams.find((team) => team.id === link.teamId))
      .filter((team): team is SecurityView["teams"][number] => Boolean(team?.enabled))
      .map((team) => [team.id, team.name]),
  );
  const found: EffectiveGrant[] = [];
  for (const grant of view.grants) {
    if (!grant.enabled) continue;
    if (grant.subjectType === "organization") found.push({ ...grant, via: "organization" });
    else if (grant.subjectType === "membership" && grant.subjectId === membershipId) found.push({ ...grant, via: "person" });
    else if (grant.subjectType === "team" && teams.has(grant.subjectId)) found.push({ ...grant, via: "team", teamName: teams.get(grant.subjectId) });
  }
  return found;
}

/** The names of the enabled teams a person belongs to. */
export function teamsOf(view: SecurityView, membershipId: string): string[] {
  return view.teamMembers.filter((link) => link.membershipId === membershipId)
    .map((link) => view.teams.find((team) => team.id === link.teamId))
    .filter((team): team is SecurityView["teams"][number] => Boolean(team?.enabled))
    .map((team) => team.name);
}

/** Counts for the Admin overview. */
export function overviewCounts(view: SecurityView) {
  const byRole = Object.fromEntries(ROLE_ORDER.map((role) => [role, view.memberships.filter((member) => member.role === role).length]));
  return {
    people: view.memberships.length,
    byRole,
    teams: view.teams.filter((team) => team.enabled).length,
    grants: view.grants.filter((grant) => grant.enabled).length,
    credentials: view.credentials.filter((credential) => credential.enabled).length,
  };
}

/** How a grant's recipient reads in a list. */
export function recipientName(view: SecurityView, grant: Pick<Grant, "subjectType" | "subjectId">): string {
  if (grant.subjectType === "organization") return "Everyone in the organization";
  if (grant.subjectType === "team") return `Team: ${view.teams.find((team) => team.id === grant.subjectId)?.name ?? "unknown"}`;
  return view.memberships.find((member) => member.id === grant.subjectId)?.name ?? "Unknown person";
}
