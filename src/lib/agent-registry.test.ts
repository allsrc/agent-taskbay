import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentIdFromCardUrl, agentRegistry } from "./agent-registry";

const ENV_KEY = "A2A_REGISTERED_AGENTS";
const originalEnvAgents = process.env[ENV_KEY];
const originalDataDir = process.env.A2A_DATA_DIR;
let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "a2a-agent-registry-"));
  process.env.A2A_DATA_DIR = tempDir;
});

afterEach(async () => {
  if (originalEnvAgents === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = originalEnvAgents;
  if (originalDataDir === undefined) delete process.env.A2A_DATA_DIR;
  else process.env.A2A_DATA_DIR = originalDataDir;
  await rm(tempDir, { recursive: true, force: true });
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
    expect(agents.every((agent) => agent.source === "env")).toBe(true);
  });

  it("resolves a single agent by id", async () => {
    process.env[ENV_KEY] = "https://a.example.com/card.json";
    const [agent] = await agentRegistry().list();
    await expect(agentRegistry().get(agent.id)).resolves.toMatchObject({ cardUrl: agent.cardUrl });
    await expect(agentRegistry().get("unknown")).resolves.toBeUndefined();
  });

  it("adds a managed agent and persists it across list() calls", async () => {
    delete process.env[ENV_KEY];
    const added = await agentRegistry().add("https://c.example.com/card.json");
    expect(added.source).toBe("managed");
    const agents = await agentRegistry().list();
    expect(agents.map((agent) => agent.cardUrl)).toContain("https://c.example.com/card.json");
  });

  it("rejects an invalid card URL", async () => {
    await expect(agentRegistry().add("not-a-url")).rejects.toThrow();
  });

  it("is idempotent when adding the same URL twice", async () => {
    await agentRegistry().add("https://d.example.com/card.json");
    await agentRegistry().add("https://d.example.com/card.json");
    const agents = await agentRegistry().list();
    expect(agents.filter((agent) => agent.cardUrl === "https://d.example.com/card.json")).toHaveLength(1);
  });

  it("removes a managed agent but not an env-seeded one", async () => {
    process.env[ENV_KEY] = "https://env.example.com/card.json";
    const managed = await agentRegistry().add("https://managed.example.com/card.json");
    await expect(agentRegistry().remove(managed.id)).resolves.toBe(true);
    const envId = agentIdFromCardUrl("https://env.example.com/card.json");
    await expect(agentRegistry().remove(envId)).resolves.toBe(false);
    const agents = await agentRegistry().list();
    expect(agents.map((agent) => agent.cardUrl)).toEqual(["https://env.example.com/card.json"]);
  });
});
