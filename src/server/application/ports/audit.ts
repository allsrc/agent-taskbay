import type { Principal } from "./identity";
import type { TaskRecord } from "../../domain/persistence-model";

export type AuditGroup = "all" | "approvals" | "ownership" | "commands" | "access";

export interface AuditQuery {
  taskId?: string;
  group?: AuditGroup;
  actorUserId?: string;
  since?: Date;
  until?: Date;
  /** Opaque position from a previous page. */
  cursor?: string;
  limit: number;
}

/** One normalized fact from any immutable source, newest first. `key` is stable and unique across sources. */
export interface AuditRow {
  key: string;
  at: Date;
  kind: string;
  actorUserId: string | null;
  taskId: string | null;
  subjectId: string | null;
  data: Record<string, unknown>;
}

export interface AuditRepository {
  page(organizationId: string, query: Omit<AuditQuery, "taskId"> & { taskId?: string }): Promise<AuditRow[]>;
}

export interface AuditPorts {
  audit: AuditRepository;
  tasks: { findById(organizationId: string, id: string): Promise<TaskRecord | undefined> };
  canRead(principal: Principal, agentId: string, skillId: string | null): Promise<boolean>;
  /** Display names keyed by user ID and membership ID, for people in this organization only. */
  names(organizationId: string, userIds: string[], membershipIds: string[]): Promise<Record<string, string>>;
  /** Task titles, agent names and states for the tasks an entry set refers to. */
  taskContext(organizationId: string, taskIds: string[]): Promise<Record<string, { title: string | null; agentName: string; state: string }>>;
}

export interface AuditUnitOfWork {
  run<T>(work: (ports: AuditPorts) => Promise<T>): Promise<T>;
}
