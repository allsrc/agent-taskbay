import type { OutboxRepository } from "./persistence";

/** Equality tokens only: never use them as durable content or replay cursors. */
export interface FreshnessReader {
  readToken(organizationId: string): Promise<string>;
}
export interface RealtimePublisher {
  publish(organizationId: string): Promise<void>;
}
export interface FreshnessUnitOfWork {
  run<T>(work: (outbox: OutboxRepository) => Promise<T>): Promise<T>;
}
