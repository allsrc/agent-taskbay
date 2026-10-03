import { DatabaseAgentRegistry } from "../server/adapters/db/agent-registry";
import type { AgentRegistry } from "../server/application/ports/agent-registry";

export type { AgentRegistry, RegisteredAgent } from "../server/application/ports/agent-registry";
export { legacyAgentIdFromCardUrl as agentIdFromCardUrl } from "../server/application/services/agent-catalog";

let registry: AgentRegistry | undefined;

export function agentRegistry(): AgentRegistry {
  registry ??= new DatabaseAgentRegistry();
  return registry;
}
