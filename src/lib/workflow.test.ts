import { describe, expect, it } from "vitest";
import { assigneeLabel, canManage, canOperate, dueLabel, eventSummary, fromLocalInput, isOverdue, toLocalInput } from "./workflow";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const people = { "m-alice": "Alice", "u-alice": "Alice", "m-bob": "Bob", "u-bob": "Bob" };
const event = (over: object) => ({ id: "e", kind: "claimed", actorUserId: "u-alice", fromMembershipId: null, toMembershipId: null, dueAt: null, createdAt: "2026-10-05T12:00:00Z", ...over }) as Parameters<typeof eventSummary>[0];

describe("workflow helpers", () => {
  it("labels due and overdue time", () => {
    expect(dueLabel("2026-10-05T13:30:00Z", NOW)).toBe("Due in 1h 30m");
    expect(dueLabel("2026-10-05T11:00:00Z", NOW)).toBe("Overdue by 1h 0m");
    expect(dueLabel("2026-10-12T12:00:00Z", NOW)).toBe("Due in 7d");
    expect([isOverdue("2026-10-05T11:59:59Z", NOW), isOverdue("2026-10-05T12:00:01Z", NOW), isOverdue(null, NOW)]).toEqual([true, false, false]);
  });
  it("lets owners and administrators manage owned work, and anyone take unowned work", () => {
    const bob = { membershipId: "m-bob", role: "operator" };
    expect(canManage(bob, null)).toBe(true);
    expect(canManage(bob, { assigneeMembershipId: null })).toBe(true);
    expect(canManage(bob, { assigneeMembershipId: "m-bob" })).toBe(true);
    expect(canManage(bob, { assigneeMembershipId: "m-alice" })).toBe(false);
    expect(canManage({ membershipId: "m-root", role: "admin" }, { assigneeMembershipId: "m-alice" })).toBe(true);
    expect([canOperate("admin"), canOperate("operator"), canOperate("viewer")]).toEqual([true, true, false]);
  });
  it("names the assignee relative to the viewer", () => {
    expect(assigneeLabel(null, "m-bob", people)).toBe("Unassigned");
    expect(assigneeLabel({ assigneeMembershipId: "m-bob" }, "m-bob", people)).toBe("You");
    expect(assigneeLabel({ assigneeMembershipId: "m-alice" }, "m-bob", people)).toBe("Alice");
    expect(assigneeLabel({ assigneeMembershipId: "m-gone" }, "m-bob", people)).toBe("Another reviewer");
  });
  it("describes each kind of activity, including a failed escalation", () => {
    expect(eventSummary(event({}), people, "m-bob")).toBe("Alice claimed this task");
    expect(eventSummary(event({ kind: "assigned", toMembershipId: "m-bob" }), people, "m-bob")).toBe("Alice assigned it to you");
    expect(eventSummary(event({ kind: "released", fromMembershipId: "m-alice" }), people, "m-bob")).toBe("Alice released it (was Alice)");
    expect(eventSummary(event({ kind: "due_cleared" }), people, "m-bob")).toBe("Alice cleared the due time");
    expect(eventSummary(event({ kind: "escalated", actorUserId: null, fromMembershipId: "m-alice", toMembershipId: "m-bob" }), people, "m-bob"))
      .toBe("Escalated from Alice to you after it became overdue");
    expect(eventSummary(event({ kind: "escalated", actorUserId: null, fromMembershipId: "m-alice", toMembershipId: null }), people, "m-bob"))
      .toMatch(/could not take it; Alice keeps it/);
  });
  it("round-trips local datetime input without shifting the instant", () => {
    const iso = "2026-10-05T12:34:00.000Z";
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect(toLocalInput(null)).toBe("");
    expect(fromLocalInput("")).toBeNull();
  });
});
