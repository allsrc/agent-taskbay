import { createHash, randomUUID } from "node:crypto";
import type { AgentRepository } from "../ports/persistence";
import type { ExtendedCardGateway } from "../ports/extended-card";

export class ExtendedCardError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export class FetchExtendedCardService {
  constructor(private readonly agents: AgentRepository, private readonly gateway: ExtendedCardGateway) {}

  async fetch(organizationId: string, agentId: string) {
    const agent = await this.agents.findById(organizationId, agentId);
    if (!agent?.enabled) throw new ExtendedCardError("Unknown agent.", 404);
    const result = await this.gateway.fetch(agent);
    if (!result) return undefined;
    if (!(await this.agents.findById(organizationId, agentId))?.enabled) throw new ExtendedCardError("Unknown agent.", 404);
    return this.agents.appendCardSnapshot({
      id: randomUUID(), agentId, kind: "extended", fetchedAt: new Date(), resolvedCardUrl: null,
      rawCardJson: result.card, normalizedCardJson: result.card, complianceJson: {}, signatureStatus: result.signatureStatus,
      digest: createHash("sha256").update(JSON.stringify(result.card)).digest("hex"),
    });
  }
}
