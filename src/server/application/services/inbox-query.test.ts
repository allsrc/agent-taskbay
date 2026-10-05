import { describe, expect, it } from "vitest";
import { InboxQueryService, decodeCursor, encodeCursor, parseInboxRequest } from "./inbox-query";
import type { InboxQuery, InboxRow } from "../ports/inbox";

const id = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const row = (n: number, over: Partial<InboxRow> = {}): InboxRow => ({ kind: "task", id: id(n), taskId: id(n), agentId: id(99), skillId: null, status: "TASK_STATE_WORKING",
  title: null, risk: null, assigneeMembershipId: null, dueAt: null, expiresAt: null, escalationLevel: 0, updatedAt: new Date(2026, 9, 5, 12, 0, 60 - n), ...over });

describe("inbox request parsing", () => {
  it("defaults, validates and rejects unknown values", () => {
    expect(parseInboxRequest({})).toMatchObject({ view: "all", limit: 30 });
    for (const bad of [{ view: "x" }, { kind: "x" }, { risk: "x" }, { agentId: "x" }, { limit: 101 }, { limit: 1.5 }, { updatedAfter: "x" }, { cursor: "x" }])
      expect(() => parseInboxRequest(bad)).toThrow();
  });
  it("round-trips a keyset cursor", () => {
    const original = row(1);
    expect(decodeCursor(encodeCursor(original))).toEqual({ updatedAt: original.updatedAt, id: original.id });
  });
});

describe("InboxQueryService", () => {
  const names = { agents: async () => ({ [id(99)]: "Agent" }), people: async () => ({}) };
  it("pages by fetching one extra row and shapes display fields", async () => {
    const seen: InboxQuery[] = [];
    const rows = [row(1), row(2, { kind: "approval", status: "pending", title: "Send it", risk: "high" }), row(3)];
    const service = new InboxQueryService({ page: async (query) => { seen.push(query); return rows.slice(0, query.limit); } }, names, { now: () => new Date("2026-10-05T12:00:00Z") });
    const page = await service.page({ organizationId: id(50), membershipId: id(51) }, { limit: 2 });
    expect(seen[0].limit).toBe(3);
    expect(page.items.map((item) => item.id)).toEqual([id(1), id(2)]);
    expect(page.items[0]).toMatchObject({ title: "Untitled task", agentName: "Agent", open: true });
    expect(page.items[1]).toMatchObject({ kind: "approval", open: true, risk: "high" });
    expect(decodeCursor(page.next!).id).toBe(id(2));
  });
  it("has no next cursor on the last page", async () => {
    const service = new InboxQueryService({ page: async () => [row(1)] }, names, { now: () => new Date() });
    expect((await service.page({ organizationId: id(50), membershipId: id(51) }, {})).next).toBeNull();
  });
});
