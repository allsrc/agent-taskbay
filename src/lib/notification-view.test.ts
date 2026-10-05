import { describe, expect, it } from "vitest";
import { needsAction, safeLink, unreadLabel } from "./notification-view";

describe("notification view helpers", () => {
  it("caps the unread badge", () => {
    expect([unreadLabel(0), unreadLabel(7), unreadLabel(99), unreadLabel(100), unreadLabel(250)]).toEqual(["0", "7", "99", "99+", "99+"]);
  });
  it("separates items that ask for action from those that inform", () => {
    expect(needsAction("approval.requested")).toBe(true);
    expect(needsAction("task.needs_input")).toBe(true);
    expect(needsAction("task.escalated")).toBe(true);
    expect(needsAction("approval.decided")).toBe(false);
    expect(needsAction("task.finished")).toBe(false);
  });
  it("only navigates to known console paths", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(safeLink(`/approvals/${id}`)).toBe(`/approvals/${id}`);
    expect(safeLink(`/tasks/${id}`)).toBe(`/tasks/${id}`);
    expect(safeLink("/notifications")).toBe("/notifications");
    for (const hostile of ["https://evil.example/x", "//evil.example", "javascript:alert(1)", "/api/audit", "/approvals/../settings", "/tasks/not-an-id"]) expect(safeLink(hostile)).toBe("/tasks");
  });
});
