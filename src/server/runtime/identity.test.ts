import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
import { verifyMutationOrigin } from "./identity";
const config = { A2A_AUTH_MODE: "oidc", A2A_OIDC_ISSUER: "https://idp.test", A2A_OIDC_CLIENT_ID: "client",
  A2A_OIDC_CLIENT_SECRET: "secret", A2A_AUTH_ORIGIN: "https://console.test", A2A_AUTH_ORGANIZATION_SLUG: "local", A2A_AUTH_FLOW_KEY: "ab".repeat(32) };
afterEach(() => vi.unstubAllEnvs());
describe("SEC-004 HTTP authentication coverage", () => {
  it("requires an exact configured Origin for cookie-authenticated mutations, ignoring forwarded host claims", () => {
    for (const [key, value] of Object.entries(config)) vi.stubEnv(key, value);
    const request = (headers: Record<string, string>) => new Request("http://internal-proxy/api/agents", { method: "POST", headers });
    expect(() => verifyMutationOrigin(request({ Origin: "https://console.test" }))).not.toThrow();
    expect(() => verifyMutationOrigin(request({}))).toThrow();
    expect(() => verifyMutationOrigin(request({ Origin: "https://evil.test", "X-Forwarded-Host": "console.test" }))).toThrow();
    expect(() => verifyMutationOrigin(request({ Origin: "https://console.test", "Sec-Fetch-Site": "cross-site" }))).toThrow();
  });
  it("admits only same-port loopback aliases for development browser mutations", () => {
    vi.stubEnv("A2A_AUTH_MODE", "development"); vi.stubEnv("A2A_ALLOW_DEVELOPMENT_AUTH", "true");
    const request = (origin: string) => new Request("http://localhost:3103/api/admin/security", {method: "POST", headers: {Origin: origin}});
    expect(() => verifyMutationOrigin(request("http://127.0.0.1:3103"))).not.toThrow();
    expect(() => verifyMutationOrigin(request("http://[::1]:3103"))).not.toThrow();
    for (const origin of ["http://127.0.0.1:3104", "https://127.0.0.1:3103", "http://evil.test:3103", "null"])
      expect(() => verifyMutationOrigin(request(origin))).toThrow();
  });
  it("protects every application route and leaves the independent authenticated webhook plane intact", () => {
    const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(directory, entry.name)) : entry.name === "route.ts" ? [join(directory, entry.name)] : []);
    for (const path of walk("src/app/api")) {
      const source = readFileSync(path, "utf8");
      if (path.includes("/webhooks/")) { expect(source).toContain("receivePush"); continue; }
      if (path.endsWith("auth/login/route.ts") || path.endsWith("auth/callback/route.ts")) continue;
      expect(source, path).toContain("authenticatedRoute(");
      expect(source, path).not.toMatch(/export async function (GET|POST|DELETE|PUT|PATCH)/);
    }
  });
});
