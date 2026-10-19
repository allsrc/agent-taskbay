import { describe, expect, it } from "vitest";
import { ID_KINDS, shortId, type IdKind } from "./identifiers";

describe("identifier registry", () => {
  it("names every kind, says what it is, and marks whether the protocol defines it", () => {
    for (const [kind, info] of Object.entries(ID_KINDS) as Array<[IdKind, (typeof ID_KINDS)[IdKind]]>) {
      expect(info.label, kind).toMatch(/\S/);
      expect(info.help.length, kind).toBeGreaterThan(20);
      expect(["A2A", "Taskbay"]).toContain(info.origin);
    }
  });

  it("uses the protocol's own field names for the A2A identifiers", () => {
    expect(ID_KINDS.task.field).toBe("taskId");
    expect(ID_KINDS.context.field).toBe("contextId");
    expect(ID_KINDS.message.field).toBe("messageId");
    expect(ID_KINDS.artifact.field).toBe("artifactId");
    expect(ID_KINDS.reference.field).toBe("referenceTaskIds");
    expect(ID_KINDS.record.origin).toBe("Taskbay");
  });

  it("keeps the start and end of a long ID and leaves a short one alone", () => {
    expect(shortId("abc")).toBe("abc");
    expect(shortId("3f9a2c1d-aaaa")).toBe("3f9a2c1d-aaaa");
    expect(shortId("3f9a2c1d-0000-1111-2222-333344445555")).toBe("3f9a2c1d…5555");
    const huge = "x".repeat(4000);
    expect(shortId(huge).length).toBe(13);
  });
});
