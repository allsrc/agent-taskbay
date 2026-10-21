import { describe, expect, it } from "vitest";
import { assertNicknameFree, NicknameTakenError, normalizeNickname } from "./agent-label";

describe("normalizeNickname", () => {
  it("trims and collapses whitespace, and treats empty as no nickname", () => {
    expect(normalizeNickname("  Support \t (ADK) ")).toBe("Support (ADK)");
    for (const empty of ["", "   ", null, undefined]) expect(normalizeNickname(empty)).toBeNull();
  });

  it("refuses a nickname that is too long or holds control characters", () => {
    expect(normalizeNickname("x".repeat(100))).toHaveLength(100);
    expect(() => normalizeNickname("x".repeat(101))).toThrow(/at most 100/);
    expect(() => normalizeNickname("a\u0007b")).toThrow(/control/);
  });
});

describe("assertNicknameFree", () => {
  const agents = [
    { id: "1", enabled: true, nickname: "Support" },
    { id: "2", enabled: false, nickname: "Retired" },
    { id: "3", enabled: true, nickname: null },
  ];

  it("refuses a name another enabled agent has, ignoring case", () => {
    expect(() => assertNicknameFree(agents, "3", "SUPPORT")).toThrow(NicknameTakenError);
  });

  it("allows the agent's own name, a removed agent's name and a new name", () => {
    expect(() => assertNicknameFree(agents, "1", "support")).not.toThrow();
    expect(() => assertNicknameFree(agents, "3", "Retired")).not.toThrow();
    expect(() => assertNicknameFree(agents, "3", "Billing")).not.toThrow();
  });
});
