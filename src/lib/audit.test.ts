import { describe, expect, it } from "vitest";
import { auditParams, describeEntry, humanizeAction } from "./audit";
import type { AuditEntryView } from "@/shared/audit-types";

const people = { "u-alice": "Alice", "m-alice": "Alice", "u-bob": "Bob", "m-bob": "Bob" };
const entry = (over: Partial<AuditEntryView>): AuditEntryView => ({ key: "k", at: "2026-10-05T12:00:00Z", kind: "decision.approve", actorUserId: "u-alice", taskId: "t", subjectId: "s", data: {}, ...over });
const describeAs = (e: AuditEntryView, viewer = "u-bob", membership = "m-bob") => describeEntry(e, people, viewer, membership);

describe("audit descriptions", () => {
  it("states who decided exactly what, with the content, revision and rationale", () => {
    const description = describeAs(entry({ data: { title: "Delete staging", text: "Yes, delete staging-old", revision: 2, digest: "a".repeat(64), rationale: "Backups confirmed", delivery: "succeeded", observedTaskState: "TASK_STATE_COMPLETED", messageId: "decision-1" } }));
    expect(description.summary).toBe("Alice approved “Delete staging”");
    expect(description.facts).toEqual([["Revision", `2 · ${"a".repeat(12)}`], ["Exact content", "Yes, delete staging-old"], ["Rationale", "Backups confirmed"],
      ["Delivery", "succeeded · task COMPLETED"], ["Message ID", "decision-1"]]);
  });
  it("calls the signed-in viewer 'You' and system actions 'The system'", () => {
    expect(describeAs(entry({ kind: "task.claimed", actorUserId: "u-bob" })).summary).toBe("You claimed the task");
    expect(describeAs(entry({ kind: "decision.expired", actorUserId: null, data: { title: "Rotate keys" } })).summary).toBe("“Rotate keys” expired without a decision");
    expect(describeAs(entry({ kind: "task.escalated", actorUserId: null, data: { fromMembershipId: "m-alice", toMembershipId: "m-bob" } })).summary)
      .toBe("Overdue task escalated from Alice to you");
    expect(describeAs(entry({ kind: "task.escalated", actorUserId: null, data: { fromMembershipId: "m-alice", toMembershipId: null } })).summary).toMatch(/could not take it; Alice kept it/);
  });
  it("covers each decision outcome and never invents content it was not given", () => {
    const base = { data: { title: "T" } };
    expect(describeAs(entry({ ...base, kind: "decision.reject" })).summary).toBe("Alice rejected “T”");
    expect(describeAs(entry({ ...base, kind: "decision.edit" })).summary).toBe("Alice edited and approved “T”");
    expect(describeAs(entry({ ...base, kind: "decision.request_changes" })).summary).toBe("Alice asked for changes to “T”");
    expect(describeAs(entry({ kind: "decision.delegate", data: { title: "T", delegateMembershipId: "m-bob" } })).summary).toBe("Alice handed “T” to you");
    expect(describeAs(entry({ kind: "decision.requested", data: { title: "T", risk: "high" } })).facts).toContainEqual(["Risk", "high"]);
    expect(describeAs(entry({ kind: "task.note_added" })).facts).toEqual([]);
    expect(describeAs(entry({ kind: "decision.approve", data: {} })).summary).toBe("Alice approved an approval request");
  });
  it("names unknown people without guessing and humanizes unfamiliar actions", () => {
    expect(describeAs(entry({ kind: "task.claimed", actorUserId: "u-gone" })).summary).toBe("A former member claimed the task");
    expect(describeAs(entry({ kind: "access.granted" })).summary).toBe("Alice granted access");
    expect(describeAs(entry({ kind: "future.thing_happened" })).summary).toBe("Alice future thing happened");
    expect(humanizeAction("task.send.accepted")).toBe("sent a message to an agent");
  });
  it("builds minimal query strings", () => {
    expect(auditParams({}).toString()).toBe("");
    expect(auditParams({ taskId: "t", group: "approvals", limit: 25 }).toString()).toBe("taskId=t&group=approvals&limit=25");
    expect(auditParams({ group: "all", since: "2026-10-05T00:00:00Z" }).get("since")).toBe("2026-10-05T00:00:00.000Z");
  });
});
