import { describe, expect, it } from "vitest";
import { legacyAgentIdFromCardUrl, validateCardUrl } from "../server/application/services/agent-catalog";

describe("agent registration identity and validation", () => {
  it("retains the legacy URL hash as a compatibility alias", () => {
    const url = "https://agents.example.com/.well-known/agent-card.json";
    expect(legacyAgentIdFromCardUrl(url)).toMatch(/^[a-f0-9]{16}$/);
    expect(legacyAgentIdFromCardUrl(url)).toBe(legacyAgentIdFromCardUrl(url));
  });

  it("accepts trimmed HTTP(S) card locations", () => {
    expect(validateCardUrl(" https://a.example.test/card.json ")).toBe("https://a.example.test/card.json");
    expect(validateCardUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("rejects invalid, non-HTTP, credential-bearing, and oversized locations", () => {
    for (const url of ["not-a-url", "file:///tmp/card.json", "https://user:secret@a.example.test", `https://a.example.test/${"x".repeat(1024)}`]) {
      expect(() => validateCardUrl(url)).toThrow();
    }
  });
});
