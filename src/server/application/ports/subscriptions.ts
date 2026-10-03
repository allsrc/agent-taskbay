import type { AgentRecord, JsonValue, SubscriptionRecord, TaskRecord } from "../../domain/persistence-model";
import type { AgentRepository, SubscriptionRepository, TaskRepository } from "./persistence";

export interface SubscriptionUnitOfWork {
  run<T>(work: (ports: { agents: AgentRepository; tasks: TaskRepository; subscriptions: SubscriptionRepository }) => Promise<T>): Promise<T>;
}
export interface A2ASubscriptionGateway {
  subscribe(agent: AgentRecord, task: TaskRecord, signal: AbortSignal): Promise<{
    events: AsyncIterable<JsonValue>;
    metadata?: StreamMetadata;
  }>;
}
export interface StreamMetadata { protocolVersion: string; transport: string; negotiatedExtensions: string[] }
export interface SubscriptionEventSink {
  /** Ingest and fence the subscription lease in the same transaction. */
  open(subscription: SubscriptionRecord, task: TaskRecord, metadata?: StreamMetadata): (event: JsonValue) => Promise<boolean>;
}
export class SubscriptionUnsupported extends Error {}
