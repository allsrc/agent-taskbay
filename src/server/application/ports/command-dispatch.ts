import type { AgentRecord, JsonValue, OutboxMessageRecord, TaskCommandRecord } from "../../domain/persistence-model";
import type { AgentRepository, TaskCommandRepository, OutboxRepository } from "./persistence";

export interface CommandUnitOfWork {
  run<T>(work: (ports: { agents: AgentRepository; commands: TaskCommandRepository; outbox: OutboxRepository }) => Promise<T>): Promise<T>;
}
export interface A2ACommandGateway {
  dispatch(agent: AgentRecord, command: TaskCommandRecord, params: Record<string, JsonValue>): Promise<JsonValue>;
}
export interface CommandResponseSink {
  /** Response ingestion and fenced command/outbox success share one transaction. */
  commit(message: OutboxMessageRecord, command: TaskCommandRecord, event: JsonValue, userMessage?: JsonValue): Promise<void>;
}
export class SafeDispatchRetry extends Error {}
export class PermanentDispatchFailure extends Error {}
