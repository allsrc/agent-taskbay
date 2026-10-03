import type { AgentRecord, TaskRecord, PushRegistrationRecord } from "../../domain/persistence-model";
import type { AgentRepository, TaskRepository } from "./persistence";

export interface PushRepository {
  sync(task: TaskRecord, now: Date): Promise<void>;
  adopt(now: Date): Promise<void>;
  retireDisabled(now: Date): Promise<void>;
  findById(id: string, lock?: boolean): Promise<PushRegistrationRecord | undefined>;
  findByTaskId(organizationId: string, taskId: string): Promise<PushRegistrationRecord | undefined>;
  claim(owner: string, now: Date, until: Date): Promise<PushRegistrationRecord | undefined>;
  renew(lease: PushRegistrationRecord, now: Date, until: Date): Promise<boolean>;
  finish(lease: PushRegistrationRecord, now: Date, changes: Pick<PushRegistrationRecord, "status" | "availableAt" | "lastError">): Promise<boolean>;
  consumeRate(id: string, now: Date, limit: number): Promise<boolean>;
}
export interface PushUnitOfWork {
  run<T>(work: (ports: { push: PushRepository; tasks: TaskRepository; agents: AgentRepository }) => Promise<T>): Promise<T>;
}
export interface PushCredentials {
  callbackUrl(registration: PushRegistrationRecord): string;
  token(registration: PushRegistrationRecord): string;
  authenticate(registration: PushRegistrationRecord, authorization: string | null): boolean;
}
export interface A2APushGateway {
  register(agent: AgentRecord, task: TaskRecord, id: string, url: string, credential: string, signal: AbortSignal): Promise<void>;
  remove(agent: AgentRecord, task: TaskRecord, id: string, signal: AbortSignal): Promise<void>;
}
export class PushUnsupported extends Error {}
export class PushReceiptError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
