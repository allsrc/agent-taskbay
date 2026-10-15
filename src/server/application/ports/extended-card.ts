import type { AgentRecord, JsonValue } from "../../domain/persistence-model";

export interface ExtendedCardGateway {
  /** Returns only a validated, credential-redacted card; undefined means not configured. */
  fetch(agent: AgentRecord): Promise<{ card: JsonValue; signatureStatus: string } | undefined>;
}
