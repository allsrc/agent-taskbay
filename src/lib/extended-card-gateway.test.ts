import { AgentCard, canonicalizeAgentCard } from "@a2a-js/sdk";
import { exportJWK, FlattenedSign, generateKeyPair } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeOperation, validateExtendedCard } from "./gateway";
import { startScenarioAgent } from "../../scripts/fixture-scenario-agent.mjs";

afterEach(() => vi.unstubAllEnvs());
const card = (extra: Record<string, unknown> = {}) => AgentCard.fromJSON({ name: "Extended", version: "1", skills: [], ...extra });

describe("extended card validation", () => {
  it("refuses private endpoints under the production policy", async () => {
    vi.stubEnv("A2A_ALLOW_PRIVATE_NETWORKS", "false");
    vi.stubEnv("A2A_ALLOWED_AGENT_ORIGINS", "");
    await expect(validateExtendedCard(card({ supportedInterfaces: [{ url: "http://127.0.0.1/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" }] }), "https://agent.test/card.json"))
      .rejects.toThrow("blocked");
  });
  it("rejects oversized cards and unsigned cards when signatures are required", async () => {
    await expect(validateExtendedCard(card({ description: "x".repeat(2 * 1024 * 1024) }), "https://agent.test/card.json")).rejects.toThrow("2 MB");
    vi.stubEnv("A2A_REQUIRE_SIGNED_CARDS", "true");
    await expect(validateExtendedCard(card(), "https://agent.test/card.json")).rejects.toThrow("trust policy");
  });
  it("rejects forged signatures, including when unsigned cards are allowed", async () => {
    vi.stubEnv("A2A_REQUIRE_SIGNED_CARDS", "false");
    await expect(validateExtendedCard(card({ signatures: [{ protected: "eyJhbGciOiJSUzI1NiIsImtpZCI6ImZvcmdlZCJ9", signature: "bad" }] }), "https://agent.test/card.json"))
      .rejects.toThrow("trust policy");
  });
  it("accepts a pinned signature and refuses the same card after tampering", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const unsigned = card();
    const signature = await new FlattenedSign(Buffer.from(canonicalizeAgentCard(unsigned)))
      .setProtectedHeader({ alg: "ES256", kid: "pinned" }).sign(privateKey);
    const signed = AgentCard.fromJSON({ ...(AgentCard.toJSON(unsigned) as Record<string, unknown>),
      signatures: [{ protected: signature.protected, signature: signature.signature }] });
    vi.stubEnv("A2A_REQUIRE_SIGNED_CARDS", "true");
    vi.stubEnv("A2A_TRUSTED_CARD_KEYS", JSON.stringify([{ origin: "https://agent.test", kid: "pinned",
      jwk: { ...await exportJWK(publicKey), alg: "ES256" }, expiresAt: "2099-01-01T00:00:00Z" }]));
    expect(await validateExtendedCard(signed, "https://agent.test/card.json")).toBe("verified");
    await expect(validateExtendedCard({ ...signed, name: "Tampered" }, "https://agent.test/card.json")).rejects.toThrow("trust policy");
  });
  it("redacts credential echoes from the SDK result", async () => {
    const agent = await startScenarioAgent({ behaviors: { extendedCard: { skills: [{ id: "private", name: "private-bearer-value" }] } } });
    try {
      const result = await executeOperation({ action: "extendedCard", connection: { cardUrl: agent.cardUrl, headers: {},
        auth: { type: "bearer", token: "private-bearer-value" }, credentialOrigins: [agent.origin], secretValues: ["private-bearer-value"] } });
      expect(JSON.stringify(result.result)).not.toContain("private-bearer-value");
      expect(JSON.stringify(result.result)).toContain("[redacted]");
      expect((await agent.state()).log.some((entry: { method: string }) => entry.method === "GetExtendedAgentCard")).toBe(true);
      expect(result.cardTrust).toBe("unsigned");
    } finally { await agent.close(); }
  });
  it("caps the extended response before SDK parsing", async () => {
    const agent = await startScenarioAgent({ behaviors: { extendedCard: { skills: [{ id: "huge", description: "x".repeat(2 * 1024 * 1024) }] } } });
    try {
      await expect(executeOperation({ action: "extendedCard", connection: { cardUrl: agent.cardUrl, headers: {}, auth: { type: "none" } } })).rejects.toThrow();
    } finally { await agent.close(); }
  });
});
