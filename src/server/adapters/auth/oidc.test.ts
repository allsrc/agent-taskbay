import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { describe, it, expect } from "vitest";
import { loadAuthConfig } from "./config";
import { OidcIdentityAdapter, opaqueToken, tokenHash, sealFlow, openFlow, safeReturnTo, type LoginFlow } from "./oidc";
import { authorize } from "../../application/services/authorization";
import type { Principal } from "../../application/ports/identity";
import { withPrincipal, currentPrincipal } from "./principal-context";

const environment = { NODE_ENV: "production", A2A_AUTH_MODE: "oidc", A2A_OIDC_ISSUER: "https://idp.example.test",
  A2A_OIDC_CLIENT_ID: "console", A2A_OIDC_CLIENT_SECRET: "server-secret", A2A_AUTH_ORIGIN: "https://console.example.test",
  A2A_AUTH_ORGANIZATION_SLUG: "tenant", A2A_AUTH_FLOW_KEY: "ab".repeat(32) };

describe("SEC-001 Plane A library adapters", () => {
  it("fails closed on missing/invalid production configuration without revealing values", () => {
    expect(loadAuthConfig({ NODE_ENV: "development" })).toEqual({ mode: "development" });
    expect(() => loadAuthConfig({ NODE_ENV: "production" })).toThrow("Authentication is not configured correctly.");
    expect(() => loadAuthConfig({ NODE_ENV: "production", A2A_AUTH_MODE: "development" })).toThrow();
    expect(loadAuthConfig({ NODE_ENV: "production", A2A_AUTH_MODE: "development", A2A_ALLOW_DEVELOPMENT_AUTH: "true" })).toEqual({ mode: "development" });
    for (const patch of [{ A2A_OIDC_ISSUER: "http://idp.test" }, { A2A_OIDC_ISSUER: "https://secret@idp.test" },
      { A2A_AUTH_ORIGIN: "https://console.test/path" }, { A2A_AUTH_FLOW_KEY: "secret" }, { A2A_AUTH_SESSION_SECONDS: "999999" }]) {
      expect(() => loadAuthConfig({ ...environment, ...patch })).toThrow("Authentication is not configured correctly.");
    }
  });
  it("uses authenticated JWE for server flow storage and sanitizes redirect paths", async () => {
    const flow = { state: "state", nonce: "nonce", verifier: "private-verifier", returnTo: "/tasks" };
    const key = Buffer.from(environment.A2A_AUTH_FLOW_KEY, "hex");
    const sealed = await sealFlow(flow, key);
    expect(sealed).not.toContain(flow.verifier);
    expect(await openFlow(sealed, key)).toEqual(flow);
    await expect(openFlow(sealed, Buffer.alloc(32))).rejects.toThrow();
    await expect(openFlow(sealed.slice(0, -8) + "tampered", key)).rejects.toThrow();
    for (const path of ["https://evil.test", "//evil.test", "/\\evil", "/%2f%2fevil", "/\nevil", "/%0d%0aevil"]) expect(safeReturnTo(path)).toBe("/tasks");
    expect(safeReturnTo("/tasks?filter=active")).toBe("/tasks?filter=active");
    const token = opaqueToken();
    expect(token).toHaveLength(43); expect(tokenHash(token)).toHaveLength(64); expect(tokenHash(token)).not.toBe(token);
  });
  it("validates real signed ID tokens, issuer/audience/expiry/nonce/state and PKCE through openid-client", async () => {
    const config = loadAuthConfig(environment);
    if (config.mode !== "oidc") throw new Error();
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const other = await generateKeyPair("RS256");
    const jwk = { ...await exportJWK(publicKey), kid: "fixture", alg: "RS256" };
    let variant = "valid";
    let tokensRequested = 0;
    const adapter = new OidcIdentityAdapter(config, async (url, init) => {
      if (String(url).includes(".well-known")) return Response.json({ issuer: config.issuer,
        authorization_endpoint: `${config.issuer}/authorize`, token_endpoint: `${config.issuer}/token`, jwks_uri: `${config.issuer}/jwks`,
        response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"] });
      if (String(url).endsWith("/jwks")) return Response.json({ keys: [jwk] });
      expect(String(url)).toBe(`${config.issuer}/token`); tokensRequested++;
      const body = init.body as URLSearchParams;
      expect(body.get("code_verifier")).toBe(flow.verifier);
      expect(body.get("redirect_uri")).toBe(`${config.origin}/api/auth/callback`);
      expect(body.get("client_secret")).toBe(config.clientSecret);
      const jwt = await new SignJWT({ nonce: variant === "nonce" ? "wrong" : flow.nonce,
        organization: "foreign", role: "admin", email: "not-authority@example.test" })
        .setProtectedHeader({ alg: "RS256", kid: "fixture" }).setSubject("known-subject")
        .setIssuer(variant === "issuer" ? "https://evil.test" : config.issuer)
        .setAudience(variant === "audience" ? "other-client" : config.clientId)
        .setIssuedAt().setExpirationTime(variant === "expiry" ? Math.floor(Date.now() / 1000) - 600 : "5m")
        .sign(variant === "signature" ? other.privateKey : privateKey);
      return Response.json({ token_type: "Bearer", access_token: "must-not-leave-server", id_token: jwt });
    });
    const begin = await adapter.begin("//evil.test"); const flow: LoginFlow = begin.flow;
    expect(begin.url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(begin.url.searchParams.has("code_challenge")).toBe(true);
    expect(begin.url.searchParams.get("scope")).toBe("openid profile");
    const callback = new URL(`https://attacker-host.test/api/auth/callback?code=fixture&state=${flow.state}`);
    expect(await adapter.complete(callback, flow)).toEqual({ issuer: config.issuer, subject: "known-subject" });
    for (const mode of ["nonce", "issuer", "audience", "expiry", "signature"]) {
      variant = mode;
      await expect(adapter.complete(callback, flow)).rejects.toThrow();
    }
    const before = tokensRequested;
    await expect(adapter.complete(new URL("https://console.test/api/auth/callback?code=fixture&state=wrong"), flow)).rejects.toThrow();
    expect(tokensRequested).toBe(before);
  });
});

describe("SEC-004 organization role baseline", () => {
  const principal: Principal = { userId: "u", membershipId: "m", organizationId: "o", displayName: "Operator", role: "viewer" };
  it("denies viewer commands and non-admin registration", () => {
    expect(() => authorize(principal, "read")).not.toThrow();
    expect(() => authorize(principal, "operate")).toThrow();
    expect(() => authorize({ ...principal, role: "operator" }, "operate")).not.toThrow();
    expect(() => authorize({ ...principal, role: "operator" }, "administer")).toThrow();
    expect(() => authorize({ ...principal, role: "admin" }, "administer")).not.toThrow();
  });
  it("isolates simultaneous requests without retaining an actor in a global mutable field", async () => {
    const results = await Promise.all(["one", "two"].map((organizationId) => withPrincipal({ ...principal, organizationId }, async () => {
      await Promise.resolve(); return currentPrincipal()?.organizationId;
    })));
    expect(results).toEqual(["one", "two"]); expect(currentPrincipal()).toBeUndefined();
  });
});
