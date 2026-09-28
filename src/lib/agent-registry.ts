import { createHash } from "node:crypto";

/**
 * The org's catalog of known A2A agents (design doc §7.2.1). Kept behind an
 * interface so a real directory service can back it later -- this env-driven
 * list is only the v1 implementation, not the final design.
 */
export interface RegisteredAgent {
  id: string;
  cardUrl: string;
}

export interface AgentRegistry {
  list(): Promise<RegisteredAgent[]>;
  get(id: string): Promise<RegisteredAgent | undefined>;
}

export function agentIdFromCardUrl(cardUrl: string): string {
  return createHash("sha256").update(cardUrl).digest("hex").slice(0, 16);
}

class EnvAgentRegistry implements AgentRegistry {
  private entries(): RegisteredAgent[] {
    const raw = process.env.A2A_REGISTERED_AGENTS ?? "";
    return [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))]
      .map((cardUrl) => ({ id: agentIdFromCardUrl(cardUrl), cardUrl }));
  }

  async list(): Promise<RegisteredAgent[]> {
    return this.entries();
  }

  async get(id: string): Promise<RegisteredAgent | undefined> {
    return this.entries().find((entry) => entry.id === id);
  }
}

let registry: AgentRegistry | undefined;

export function agentRegistry(): AgentRegistry {
  registry ??= new EnvAgentRegistry();
  return registry;
}
