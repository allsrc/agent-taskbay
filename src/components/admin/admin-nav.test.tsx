import { describe, expect, it } from "vitest";
import { ADMIN_LINKS } from "./admin-nav";

describe("Admin sub-navigation", () => {
  it("has one tab per job, starting at the overview, and ends at the audit trail inside Administration", () => {
    expect(ADMIN_LINKS.map((link) => link.href)).toEqual(["/admin", "/admin/people", "/admin/teams", "/admin/access", "/admin/policies", "/admin/audit"]);
    expect(ADMIN_LINKS[0].exact).toBe(true);
  });
});
