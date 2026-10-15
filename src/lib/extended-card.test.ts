import { describe, expect, it } from "vitest";
import { mergeExtendedSkills, viewExtendedCard } from "./extended-card";

describe("extended card display", () => {
  it("keeps public skills first and unchanged, labels only new skills, and removes duplicates", () => {
    const publicSkills = [{ id: "work", name: "Public", description: "Public description", examples: [] }];
    const extended = viewExtendedCard({ skills: [{ id: "work", name: "Changed" }, { id: "extra", name: "Extra" }, { id: "extra" }] }, new Date(0));
    expect(mergeExtendedSkills(publicSkills, extended)).toEqual([
      { ...publicSkills[0], authenticated: false }, { id: "extra", name: "Extra", description: "", examples: [], authenticated: true },
    ]);
    expect(publicSkills).toHaveLength(1);
  });
  it("exposes only display fields, not endpoints, secrets, signatures or extension parameters", () => {
    const view = viewExtendedCard({ url: "https://secret.test", securitySchemes: { secret: "value" }, signatures: ["signature"],
      capabilities: { streaming: true, extensions: [{ uri: "private", params: { secret: true } }] }, skills: [] }, new Date(0));
    expect(view).toEqual({ fetchedAt: "1970-01-01T00:00:00.000Z", skills: [], capabilities: { streaming: true, pushNotifications: false } });
  });
});
