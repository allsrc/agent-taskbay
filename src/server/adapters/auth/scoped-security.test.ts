import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCard, generateAgentCardSignature } from "@a2a-js/sdk";
import { exportJWK, generateKeyPair } from "jose";
import { AccessPolicy, SKILL_ROUTING_EXTENSION } from "../../application/services/access-policy";
import { verifyCardTrust } from "./card-trust";
import { addressAllowed, resolveTarget, validateTargetUrl } from "../../../lib/url-safety";
import { redactSecrets } from "../../../lib/safe-fetch";
import { credentialBindingSchema } from "./credential-schema";
import type { Principal } from "../../application/ports/identity";
import type { AccessGrant } from "../../application/ports/security";
const principal: Principal = {userId: "user", membershipId: "member", organizationId: "org", displayName: "User", role: "operator"};
const grant: AccessGrant = {id: "grant", organizationId: "org", subjectType: "membership", subjectId: "member", agentId: "agent", skillId: "public", permission: "operate", enabled: true};
afterEach(() => vi.unstubAllEnvs());
describe("SEC-002..005 bounded policy and trust", () => {
  it("denies unrestricted invocation, foreign/revoked grants and viewer writes; hides unrelated skills", () => {
    const policy = new AccessPolicy(principal, [grant]);
    expect(policy.allows("agent", "operate")).toBe(false);
    expect(policy.allows("agent", "operate", "public")).toBe(true);
    expect(policy.allows("agent", "read", "private")).toBe(false);
    expect(policy.filterCard("agent", {skills: [{id: "public"}, {id: "private"}], description: "private details", metadata: {secret: "hidden"}}))
      .toMatchObject({skills: [{id: "public"}], description: "Restricted skill access", access: {requiresSkill: true}});
    expect(new AccessPolicy({...principal, role: "viewer"}, [grant]).allows("agent", "operate", "public")).toBe(false);
    expect(new AccessPolicy(principal, [{...grant, organizationId: "foreign"}]).discovers("agent")).toBe(false);
    expect(new AccessPolicy(principal, [{...grant, enabled: false}]).discovers("agent")).toBe(false);
    expect(SKILL_ROUTING_EXTENSION).toBe("urn:a2a-ops:skill-routing:1");
  });
  it("rejects metadata, mapped IPv4, mixed DNS answers, insecure production targets and ambiguous allowlists", async () => {
    for (const address of ["169.254.169.254", "::ffff:169.254.169.254", "fe80::1", "224.0.0.1", "0.0.0.0"]) expect(addressAllowed(address, true)).toBe(false);
    expect(addressAllowed("::ffff:127.0.0.1", false)).toBe(false);
    expect(addressAllowed("127.0.0.1", true)).toBe(true);
    vi.stubEnv("A2A_ALLOW_PRIVATE_NETWORKS", "false");
    const resolver = vi.fn().mockResolvedValue([{address: "8.8.8.8", family: 4}, {address: "127.0.0.1", family: 4}]);
    await expect(resolveTarget("https://example.test/card", resolver)).rejects.toThrow("blocked");
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("A2A_AUTH_MODE", "oidc");
    vi.stubEnv("A2A_ALLOWED_AGENT_ORIGINS", "https://example.test");
    expect(validateTargetUrl("https://example.test/card").origin).toBe("https://example.test");
    for (const url of ["http://example.test/card", "https://example.test.evil/card", "https://secret@example.test/card", "https://example.test/card?token=secret"])
      expect(() => validateTargetUrl(url)).toThrow();
  });
  it("redacts encoded credentials in keys, nested protocol content and sidebands", () => {
    const secret = "private-token-123";
    const output = redactSecrets({[secret]: [{text: `echo:${secret}`, metadata: Buffer.from(secret).toString("base64"), raw: Buffer.from(`prefix ${secret} suffix`).toString("base64")} ]}, [secret]);
    expect(Buffer.from(Object.values(output)[0][0].raw, "base64").toString()).not.toContain(secret);
    expect(JSON.stringify(output)).not.toContain(secret);
    expect(JSON.stringify(output)).not.toContain(Buffer.from(secret).toString("base64"));
  });
  it("rejects browser/header injection and non-origin credential bindings", () => {
    expect(credentialBindingSchema.safeParse({origins: ["https://example.test"], credential: {type: "apiKey", name: "Host", value: "private-key"}}).success).toBe(false);
    expect(credentialBindingSchema.safeParse({origins: ["https://example.test/route"], credential: {type: "bearer", token: "private-key"}}).success).toBe(false);
  });
  it("verifies SDK canonical signatures with origin-pinned public keys; tampering, expired/unknown keys fail closed", async () => {
    const {privateKey, publicKey} = await generateKeyPair("RS256");
    const card = AgentCard.fromJSON({name: "Trusted", version: "1", skills: [], capabilities: {}});
    const signed = await generateAgentCardSignature(privateKey, {alg: "RS256", kid: "trusted", typ: "JOSE"})(card);
    vi.stubEnv("A2A_TRUSTED_CARD_KEYS", JSON.stringify([{origin: "https://agent.test", kid: "trusted", jwk: {...await exportJWK(publicKey), alg: "RS256"}, expiresAt: "2099-01-01T00:00:00Z"}]));
    expect(await verifyCardTrust(signed, "https://agent.test")).toBe("verified");
    expect(await verifyCardTrust({...signed, name: "Tampered"}, "https://agent.test")).toBe("invalid");
    expect(await verifyCardTrust(signed, "https://other.test")).toBe("untrusted");
    vi.stubEnv("A2A_TRUSTED_CARD_KEYS", JSON.stringify([{origin: "https://agent.test", kid: "trusted", jwk: {...await exportJWK(publicKey), alg: "RS256"}, expiresAt: "2000-01-01T00:00:00Z"}]));
    expect(await verifyCardTrust(signed, "https://agent.test")).toBe("untrusted");
    vi.stubEnv("A2A_TRUSTED_CARD_KEYS", "[]"); expect(await verifyCardTrust(signed, "https://agent.test")).toBe("untrusted");
    expect(await verifyCardTrust(card, "https://agent.test")).toBe("unsigned");
    expect(await verifyCardTrust(AgentCard.toJSON(card) as AgentCard, "https://agent.test")).toBe("unsigned");
  });
});
