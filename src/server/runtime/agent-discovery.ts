import { registeredAgentConnection, filterAgentCard } from "./security";
import { createHash } from "node:crypto";

import { discoverAgent } from "../../lib/gateway";
import { ensureDiscoveryCursorsFor } from "./discovery-cursors";
import { buildConnectionView } from "../../lib/connection-interface";
import { agentRegistry } from "../../lib/agent-registry";
import type { AgentRegistry, RegisteredAgent } from "../application/ports/agent-registry";
import type { JsonValue } from "../domain/persistence-model";

export async function discoverRegisteredAgent(
  agent: RegisteredAgent,
  registry: AgentRegistry = agentRegistry(),
  connection = registeredAgentConnection,
) {
  const config = await connection(agent);
  const discovery = await discoverAgent(config);
  const card = discovery.card;
  await registry.recordDiscovery(agent.id, {
    signatureStatus: discovery.trust ?? "unsigned",
    resolvedCardUrl: discovery.resolvedCardUrl ?? null,
    rawCardJson: discovery.rawCard as JsonValue,
    normalizedCardJson: card as JsonValue,
    complianceJson: JSON.parse(JSON.stringify(discovery.report)) as JsonValue,
    digest: createHash("sha256").update(JSON.stringify(discovery.rawCard)).digest("hex"),
    displayName: typeof card.name === "string" ? card.name.slice(0, 300) : null,
    description: typeof card.description === "string" ? card.description : null,
    protocolSnapshotVersion: discovery.report.version,
  });
  // An agent in automatic discovery needs list cursors; the first card is what tells us its tenants. Best effort: the worker also does this at start.
  await ensureDiscoveryCursorsFor(agent.id).catch(() => undefined);
  const filtered = await filterAgentCard(agent.id, discovery.card);
  const partial = filtered !== discovery.card;
  // The Connection card shows what the gateway would use for this saved connection, from the unfiltered card.
  const sideband = discovery.sideband;
  const connectionView = buildConnectionView(discovery.normalizedCard?.supportedInterfaces ?? [], config, {
    advertised: sideband?.advertisedUris ?? [], negotiated: sideband?.negotiatedUris ?? [],
    required: sideband?.requiredUris ?? [], unsupportedRequired: sideband?.unsupportedRequiredUris ?? [],
  });
  return { ...discovery, connection: connectionView, card: filtered, report: partial ? {...discovery.report, issues: [], passed: []} : discovery.report, telemetry: [] };
}
