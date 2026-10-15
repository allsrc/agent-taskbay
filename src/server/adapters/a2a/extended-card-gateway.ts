import { executeOperation } from "../../../lib/gateway";
import type { ExtendedCardGateway } from "../../application/ports/extended-card";
import type { JsonValue } from "../../domain/persistence-model";
import { agentConnection } from "./agent-connection";
import { classifyRemoteError } from "./remote-error-map";

export const extendedCardGateway: ExtendedCardGateway = {
  async fetch(agent) {
    try {
      const response = await executeOperation({ connection: await agentConnection(agent), action: "extendedCard" });
      return { card: response.result as JsonValue, signatureStatus: response.cardTrust ?? "unsigned" };
    } catch (error) {
      if (classifyRemoteError(error)?.kind === "extended_card_not_configured") return undefined;
      // Never expose a remote message, credentials, or a card in an error response.
      throw new Error("Extended Agent Card fetch failed.");
    }
  },
};
