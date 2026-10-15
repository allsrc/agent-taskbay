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
  /** Agents with enabled push whose finished registrations are due a leftover-configuration check. */
  cleanupAgents(now: Date, window: CleanupWindow, limit: number): Promise<{ organizationId: string; agentId: string }[]>;
  /** The next registrations of one agent due a check, least recently checked first. */
  cleanupBatch(organizationId: string, agentId: string, now: Date, window: CleanupWindow, limit: number): Promise<PushRegistrationRecord[]>;
  /** Records that these registrations were checked, so each is looked at once per recheck period. */
  markChecked(organizationId: string, ids: string[], now: Date): Promise<void>;
  /** A database-backed "at most once per interval" claim, shared by every worker and instance. */
  claimCleanup(agentId: string, now: Date, intervalMs: number): Promise<boolean>;
  auditCleanup(organizationId: string, agentId: string, cleaned: number): Promise<void>;
}
/** Registrations last touched between `since` and `recheckBefore` are due. */
export interface CleanupWindow { since: Date; recheckBefore: Date }
export interface PushConfigSummary { id: string; url: string }
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
  /** The configurations the agent holds for the task; empty when the agent has no push support. */
  list(agent: AgentRecord, task: TaskRecord, signal: AbortSignal): Promise<PushConfigSummary[]>;
}
export class PushUnsupported extends Error {}
export class PushReceiptError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
