import { describe, expect, it } from "vitest";
import { effectiveGrants, overviewCounts, recipientName, teamsOf, type SecurityView } from "./admin-access";

const view: SecurityView = {
  organizationId: "org",
  teams: [{ id: "t1", name: "Ops", enabled: true }, { id: "t2", name: "Old", enabled: false }],
  memberships: [{ id: "m1", name: "Ada", role: "operator" }, { id: "m2", name: "Bo", role: "viewer" }, { id: "m3", name: "Cy", role: "admin" }],
  teamMembers: [{ id: "l1", teamId: "t1", membershipId: "m1" }, { id: "l2", teamId: "t2", membershipId: "m1" }],
  grants: [
    { id: "g1", subjectType: "organization", subjectId: "org", agentId: "a1", skillId: null, permission: "read", enabled: true },
    { id: "g2", subjectType: "team", subjectId: "t1", agentId: "a2", skillId: "s", permission: "operate", enabled: true },
    { id: "g3", subjectType: "team", subjectId: "t2", agentId: "a3", skillId: null, permission: "read", enabled: true },
    { id: "g4", subjectType: "membership", subjectId: "m1", agentId: "a4", skillId: null, permission: "read", enabled: true },
    { id: "g5", subjectType: "membership", subjectId: "m2", agentId: "a5", skillId: null, permission: "read", enabled: true },
    { id: "g6", subjectType: "organization", subjectId: "org", agentId: "a6", skillId: null, permission: "read", enabled: false },
  ],
  credentials: [{ agentId: "a1", kind: "bearer", enabled: true, updatedAt: "" }, { agentId: "a2", kind: "bearer", enabled: false, updatedAt: "" }],
};

describe("admin access reading", () => {
  it("combines organization, team and personal grants, skipping revoked grants and disabled teams", () => {
    const grants = effectiveGrants(view, "m1");
    expect(grants.map((grant) => [grant.id, grant.via])).toEqual([["g1", "organization"], ["g2", "team"], ["g4", "person"]]);
    expect(grants[1].teamName).toBe("Ops");
  });

  it("gives a person with no teams only the organization grants and their own", () => {
    expect(effectiveGrants(view, "m2").map((grant) => grant.id)).toEqual(["g1", "g5"]);
  });

  it("lists only enabled teams", () => expect(teamsOf(view, "m1")).toEqual(["Ops"]));

  it("counts people by role, enabled teams, enabled grants and enabled credentials", () => {
    expect(overviewCounts(view)).toEqual({ people: 3, byRole: { admin: 1, operator: 1, viewer: 1 }, teams: 1, grants: 5, credentials: 1 });
  });

  it("names a grant's recipient", () => {
    expect(recipientName(view, view.grants[0])).toBe("Everyone in the organization");
    expect(recipientName(view, view.grants[1])).toBe("Team: Ops");
    expect(recipientName(view, view.grants[3])).toBe("Ada");
  });
});
