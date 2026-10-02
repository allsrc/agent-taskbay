import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/gateway", () => ({ discoverAgent: vi.fn() }));
vi.mock("../../lib/agent-registry", () => ({ agentRegistry: vi.fn() }));

import { discoverAgent } from "../../lib/gateway";
import type { AgentRegistry } from "../application/ports/agent-registry";
import { discoverRegisteredAgent } from "./agent-discovery";

describe("AGT-002/003 registered discovery persistence", () => {
  it("stores raw and normalized cards plus compliance without wire telemetry", async () => {
    const discovery = {
      resolvedCardUrl: "https://example.test/.well-known/agent-card.json",
      rawCard: { name: "Legacy", protocolVersion: "0.3.0" },
      card: { name: "Agent", description: "Description", supportedInterfaces: [] },
      report: { version: "0.3" as const, score: 90, counts: { error: 0, warning: 1, info: 0 }, issues: [], passed: [] },
      telemetry: [{ id: "wire", timestamp: "now", phase: "request" as const, headers: { Authorization: "secret" } }],
      latencyMs: 10,
      normalizedCard: {} as Awaited<ReturnType<typeof discoverAgent>>["normalizedCard"],
    };
    vi.mocked(discoverAgent).mockResolvedValue(discovery);
    const registry: AgentRegistry = {
      list: vi.fn(), get: vi.fn(), add: vi.fn(), remove: vi.fn(), recordDiscovery: vi.fn(),
    };
    const agent = { id: "local-id", cardUrl: "https://example.test", source: "managed" as const };
    expect(await discoverRegisteredAgent(agent, registry)).toBe(discovery);
    expect(registry.recordDiscovery).toHaveBeenCalledWith(agent.id, {
      resolvedCardUrl: discovery.resolvedCardUrl,
      rawCardJson: discovery.rawCard, normalizedCardJson: discovery.card,
      complianceJson: discovery.report,
      digest: createHash("sha256").update(JSON.stringify(discovery.rawCard)).digest("hex"),
      displayName: "Agent", description: "Description", protocolSnapshotVersion: "0.3",
    });
    expect(JSON.stringify(vi.mocked(registry.recordDiscovery).mock.calls)).not.toContain("secret");
  });

  it("does not create a successful snapshot when remote discovery fails", async () => {
    vi.mocked(discoverAgent).mockRejectedValue(new Error("Unavailable"));
    const registry: AgentRegistry = {
      list: vi.fn(), get: vi.fn(), add: vi.fn(), remove: vi.fn(), recordDiscovery: vi.fn(),
    };
    await expect(discoverRegisteredAgent({ id: "id", cardUrl: "https://example.test", source: "env" }, registry))
      .rejects.toThrow("Unavailable");
    expect(registry.recordDiscovery).not.toHaveBeenCalled();
  });
});
