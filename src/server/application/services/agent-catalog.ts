import { createHash, randomUUID } from "node:crypto";

import type { AgentDiscoverySnapshot, RegisteredAgent } from "../ports/agent-registry";
import type { Clock } from "../ports/clock";
import type { AgentRepository } from "../ports/persistence";
import type { AgentRecord } from "../../domain/persistence-model";

/** Compatibility alias only. Durable primary keys are locally generated UUIDs. */
export function legacyAgentIdFromCardUrl(cardUrl: string): string {
  return createHash("sha256").update(cardUrl).digest("hex").slice(0, 16);
}

export function validateCardUrl(cardUrl: string): string {
  const trimmed = cardUrl.trim();
  const url = new URL(trimmed);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Agent Card URL must be http(s).");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Agent Card URL must not contain credentials, query strings or fragments.");
  }
  if (trimmed.length > 1024) throw new Error("Agent Card URL exceeds 1024 characters.");
  return trimmed;
}

export class AgentCatalogService {
  private readonly environmentUrls: Set<string>;

  constructor(
    private readonly agents: AgentRepository,
    private readonly organizationId: string,
    environmentUrls: string[],
    private readonly clock: Clock = { now: () => new Date() },
    private readonly createId: () => string = randomUUID,
  ) {
    this.environmentUrls = new Set(environmentUrls.map(validateCardUrl));
  }

  private createAgent(cardUrl: string, source: AgentRecord["source"]): AgentRecord {
    const now = this.clock.now();
    return {
      id: this.createId(), organizationId: this.organizationId, cardUrl, source,
      enabled: true, displayName: null, description: null, protocolSnapshotVersion: null,
      lastDiscoveryAt: null, lastHealthyAt: null, createdAt: now, updatedAt: now,
    };
  }

  /** Replaying a legacy import never enables an existing removed record. */
  async importLegacy(cardUrls: string[]) {
    const validated = [...new Set(cardUrls.map(validateCardUrl))];
    for (const cardUrl of validated) {
      const agent = await this.agents.getOrCreate(this.createAgent(cardUrl, "managed"));
      if (agent.source === "env") {
        await this.agents.updateRegistration(this.organizationId, agent.id, {
          source: "managed", enabled: agent.enabled, updatedAt: this.clock.now(),
        });
      }
    }
  }

  async seedEnvironment() {
    for (const cardUrl of this.environmentUrls) {
      const agent = await this.agents.getOrCreate(this.createAgent(cardUrl, "env"));
      if (!agent.enabled) {
        await this.agents.updateRegistration(this.organizationId, agent.id, {
          source: agent.source, enabled: true, updatedAt: this.clock.now(),
        });
      }
    }
  }

  async list(): Promise<RegisteredAgent[]> {
    const agents = await this.agents.listByOrganization(this.organizationId);
    return agents.filter((agent) => agent.enabled &&
      (agent.source === "managed" || this.environmentUrls.has(agent.cardUrl)))
      .map((agent) => ({
        id: agent.id, cardUrl: agent.cardUrl,
        source: this.environmentUrls.has(agent.cardUrl) ? "env" : agent.source,
      }));
  }

  async get(id: string) {
    return (await this.list()).find((agent) =>
      agent.id === id || legacyAgentIdFromCardUrl(agent.cardUrl) === id);
  }

  async add(cardUrl: string): Promise<RegisteredAgent> {
    const validated = validateCardUrl(cardUrl);
    const isEnvironment = this.environmentUrls.has(validated);
    const agent = await this.agents.getOrCreate(this.createAgent(validated, isEnvironment ? "env" : "managed"));
    if (!agent.enabled || (!isEnvironment && agent.source !== "managed")) {
      await this.agents.updateRegistration(this.organizationId, agent.id, {
        source: isEnvironment ? agent.source : "managed", enabled: true, updatedAt: this.clock.now(),
      });
    }
    return { id: agent.id, cardUrl: validated, source: isEnvironment ? "env" : "managed" };
  }

  async remove(id: string): Promise<boolean> {
    const agent = await this.get(id);
    if (!agent || agent.source === "env") return false;
    // Retain identity and history for task references and repeatable imports.
    return this.agents.updateRegistration(this.organizationId, agent.id, {
      source: "managed", enabled: false, updatedAt: this.clock.now(),
    });
  }

  /** The caller commits snapshot and discovery metadata in one transaction. */
  async recordDiscovery(id: string, snapshot: AgentDiscoverySnapshot) {
    const agent = await this.get(id);
    if (!agent) throw new Error("Unknown agent.");
    const now = this.clock.now();
    await this.agents.appendCardSnapshot({
      id: this.createId(), agentId: agent.id, fetchedAt: now,
      resolvedCardUrl: snapshot.resolvedCardUrl,
      rawCardJson: snapshot.rawCardJson, normalizedCardJson: snapshot.normalizedCardJson,
      complianceJson: snapshot.complianceJson, digest: snapshot.digest,
      signatureStatus: snapshot.signatureStatus ?? "unverified",
    });
    await this.agents.updateDiscovery(this.organizationId, agent.id, {
      displayName: snapshot.displayName, description: snapshot.description,
      protocolSnapshotVersion: snapshot.protocolSnapshotVersion,
      lastDiscoveryAt: now, lastHealthyAt: now, updatedAt: now,
    });
  }
}
