import { afterEach, describe, expect, it } from "vitest";
import { agentIdFromCardUrl, agentRegistry } from "./agent-registry";

const ENV_KEY = "A2A_REGISTERED_AGENTS";
const original = process.env[ENV_KEY];

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = original;
});

describe("agent registry", () => {
  it("derives a stable id from an agent's card URL", () => {
    const id = agentIdFromCardUrl("https://agents.example.com/.well-known/agent-card.json");
    expect(id).toMatch(/^[a-f0-9]{16}$/);
    expect(agentIdFromCardUrl("https://agents.example.com/.well-known/agent-card.json")).toBe(id);
  });

  it("lists deduplicated agents from the env-configured registry", async () => {
    process.env[ENV_KEY] = "https://a.example.com/card.json, https://b.example.com/card.json,https://a.example.com/card.json";
    const agents = await agentRegistry().list();
    expect(agents).toHaveLength(2);
    expect(agents.map((agent) => agent.cardUrl)).toEqual([
      "https://a.example.com/card.json",
      "https://b.example.com/card.json",
    ]);
  });

  it("resolves a single agent by id", async () => {
    process.env[ENV_KEY] = "https://a.example.com/card.json";
    const [agent] = await agentRegistry().list();
    await expect(agentRegistry().get(agent.id)).resolves.toMatchObject({ cardUrl: agent.cardUrl });
    await expect(agentRegistry().get("unknown")).resolves.toBeUndefined();
  });
});
