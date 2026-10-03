import type { JsonValue } from "../../domain/persistence-model";

export interface RegisteredAgent {
  id: string;
  cardUrl: string;
  source: "env" | "managed";
}

export interface AgentDiscoverySnapshot {
  signatureStatus?: string;
  resolvedCardUrl: string | null;
  rawCardJson: JsonValue;
  normalizedCardJson: JsonValue;
  complianceJson: JsonValue;
  digest: string;
  displayName: string | null;
  description: string | null;
  protocolSnapshotVersion: string | null;
}

export interface AgentRegistry {
  list(): Promise<RegisteredAgent[]>;
  get(id: string): Promise<RegisteredAgent | undefined>;
  add(cardUrl: string): Promise<RegisteredAgent>;
  remove(id: string): Promise<boolean>;
  recordDiscovery(id: string, snapshot: AgentDiscoverySnapshot): Promise<void>;
}
