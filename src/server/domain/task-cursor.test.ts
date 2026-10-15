import { describe, expect, it } from "vitest";
import { decodeTaskCursor, encodeTaskCursor } from "./task-cursor";

const id = "3f9a2c1d-0000-4000-8000-000000000001";

describe("task list cursor", () => {
  it("round-trips the update time and id", () => {
    const updatedAt = new Date("2026-10-01T12:34:56.789Z");
    const encoded = encodeTaskCursor({ updatedAt, id });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeTaskCursor(encoded)).toEqual({ updatedAt, id });
  });
  it.each([
    "", "not base64!", "e30",
    Buffer.from('{"updatedAt":"nope","id":"x"}').toString("base64url"),
    Buffer.from('{"updatedAt":"2026-10-01T00:00:00Z","id":"x"}').toString("base64url"),
    "a".repeat(600),
  ])("rejects %s", (value) => {
    expect(decodeTaskCursor(value)).toBeUndefined();
  });
});
