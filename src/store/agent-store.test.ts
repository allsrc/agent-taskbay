import { describe, expect, it } from "vitest";
import { advertisedName, agentOptionLabel, type CatalogAgent } from "./agent-store";

const agent = (extra: Partial<CatalogAgent>): CatalogAgent => ({ id: "a", cardUrl: "https://x.test/card", source: "managed", ...extra });

describe("advertisedName", () => {
  it("returns the card name only when a nickname hides it", () => {
    expect(advertisedName(agent({ nickname: "Support (ADK)", cardName: "Support" }))).toBe("Support");
    expect(advertisedName(agent({ cardName: "Support" }))).toBeUndefined();
    expect(advertisedName(agent({ nickname: "Support", cardName: "Support" }))).toBeUndefined();
    expect(advertisedName(agent({ nickname: "Support (ADK)" }))).toBeUndefined();
    expect(advertisedName(undefined)).toBeUndefined();
  });
});

describe("agentOptionLabel", () => {
  it("puts the card name in brackets after a nickname", () => {
    expect(agentOptionLabel(agent({ nickname: "Support (ADK)", cardName: "Support", view: { name: "Support (ADK)" } as CatalogAgent["view"] }), "x")).toBe("Support (ADK) (Support)");
    expect(agentOptionLabel(agent({ cardName: "Support", view: { name: "Support" } as CatalogAgent["view"] }), "x")).toBe("Support");
    expect(agentOptionLabel(agent({}), "fallback")).toBe("fallback");
  });
});
