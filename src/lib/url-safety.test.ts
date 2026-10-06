import { afterEach, expect, it, vi } from "vitest";
import { validateTargetUrl } from "./url-safety";

afterEach(() => vi.unstubAllEnvs());

function production(env: Record<string, string>) {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("A2A_ALLOWED_AGENT_ORIGINS", "");
  vi.stubEnv("A2A_AUTH_MODE", "");
  vi.stubEnv("A2A_ALLOW_DEVELOPMENT_AUTH", "");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}

// OPS-003: the local launcher runs a production build in explicit demo mode and must be able to add any agent.
it("requires an origin allowlist for production targets", () => {
  production({});
  expect(() => validateTargetUrl("https://agent.example.com/")).toThrow("origin allowlist");
});

it("lets explicit demo mode reach any origin, over HTTP, until an allowlist is configured", () => {
  production({ A2A_AUTH_MODE: "development", A2A_ALLOW_DEVELOPMENT_AUTH: "true" });
  expect(validateTargetUrl("http://127.0.0.1:4010/showcase/card.json").origin).toBe("http://127.0.0.1:4010");
});

it("still enforces a configured allowlist in demo mode", () => {
  production({ A2A_AUTH_MODE: "development", A2A_ALLOW_DEVELOPMENT_AUTH: "true", A2A_ALLOWED_AGENT_ORIGINS: "https://allowed.example.com" });
  expect(validateTargetUrl("https://allowed.example.com/card.json").origin).toBe("https://allowed.example.com");
  expect(() => validateTargetUrl("https://other.example.com/card.json")).toThrow("origin allowlist");
});

it("does not treat development auth alone as demo mode in production", () => {
  production({ A2A_AUTH_MODE: "development" });
  expect(() => validateTargetUrl("https://agent.example.com/")).toThrow("origin allowlist");
});
