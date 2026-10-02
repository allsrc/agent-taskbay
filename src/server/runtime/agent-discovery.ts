import { createHash } from "node:crypto";

import { discoverAgent } from "../../lib/gateway";
import { agentRegistry } from "../../lib/agent-registry";
import type { AgentRegistry, RegisteredAgent } from "../application/ports/agent-registry";
import type { JsonValue } from "../domain/persistence-model";

export async function discoverRegisteredAgent(
  agent: RegisteredAgent,
  registry: AgentRegistry = agentRegistry(),
) {
  const discovery = await discoverAgent({ cardUrl: agent.cardUrl, auth: { type: "none" }, headers: {} });
  const card = discovery.card;
  await registry.recordDiscovery(agent.id, {
    resolvedCardUrl: discovery.resolvedCardUrl ?? null,
    rawCardJson: discovery.rawCard as JsonValue,
    normalizedCardJson: card as JsonValue,
    complianceJson: JSON.parse(JSON.stringify(discovery.report)) as JsonValue,
    digest: createHash("sha256").update(JSON.stringify(discovery.rawCard)).digest("hex"),
    displayName: typeof card.name === "string" ? card.name.slice(0, 300) : null,
    description: typeof card.description === "string" ? card.description : null,
    protocolSnapshotVersion: discovery.report.version,
  });
  return discovery;
}
