export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface OrganizationRecord {
  id: string;
  slug: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentRecord {
  id: string;
  organizationId: string;
  cardUrl: string;
  source: "env" | "managed";
  enabled: boolean;
  displayName: string | null;
  description: string | null;
  protocolSnapshotVersion: string | null;
  lastDiscoveryAt: Date | null;
  lastHealthyAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentCardSnapshotRecord {
  id: string;
  agentId: string;
  fetchedAt: Date;
  resolvedCardUrl: string | null;
  rawCardJson: JsonValue;
  normalizedCardJson: JsonValue;
  complianceJson: JsonValue;
  signatureStatus: string;
  digest: string;
}

export interface TaskRecord {
  contentJson?: JsonValue;
  id: string;
  organizationId: string;
  agentId: string;
  tenant: string;
  remoteTaskId: string | null;
  remoteContextId: string | null;
  kind: string;
  state: string;
  title: string | null;
  ownerUserId: string | null;
  ownerTeamId: string | null;
  createdAt: Date;
  remoteCreatedAt: Date | null;
  updatedAt: Date;
  remoteUpdatedAt: Date | null;
  terminalAt: Date | null;
  version: number;
}

export type TaskSummaryRecord = Pick<TaskRecord, "id" | "organizationId" | "agentId" | "tenant" | "remoteTaskId" | "remoteContextId" | "kind" | "state" | "title" | "createdAt" | "updatedAt" | "version">;

export type TaskEventSource =
  | "stream"
  | "webhook"
  | "reconcile"
  | "command_response"
  | "import";

export interface TaskEventRecord {
  id: string;
  organizationId: string;
  agentId: string;
  taskId: string;
  source: TaskEventSource;
  eventKind: string;
  receivedAt: Date;
  remoteTimestamp: Date | null;
  sourceKey: string;
  payloadDigest: string;
  payloadJson: JsonValue;
  sessionId: string | null;
  requestId: string | null;
  traceId: string | null;
  projectionVersion: number;
}

export type OutboxStatus = "pending" | "processing" | "processed" | "failed";

export type CommandStatus = "pending" | "dispatching" | "succeeded" | "failed" | "uncertain";
export interface TaskCommandRecord {
  id: string;
  organizationId: string;
  agentId: string;
  tenant: string;
  action: "send" | "cancelTask";
  idempotencyKey: string;
  messageId: string;
  payloadDigest: string;
  payloadObjectKey: string;
  status: CommandStatus;
  resultJson: JsonValue | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OutboxMessageRecord {
  id: string;
  organizationId: string;
  topic: string;
  aggregateType: string;
  aggregateId: string;
  payloadJson: JsonValue;
  availableAt: Date;
  attempts: number;
  status: OutboxStatus;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  lastError: string | null;
  createdAt: Date;
  processedAt: Date | null;
}
