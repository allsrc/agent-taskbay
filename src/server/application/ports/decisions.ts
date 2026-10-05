import type {
  DecisionExecutionRecord, DecisionRecord, DecisionRequestRecord, DecisionRequestStatus, DecisionRevisionRecord,
} from "../../domain/decision-model";
import type { TaskCommandRecord, TaskRecord } from "../../domain/persistence-model";
import type { Principal } from "./identity";

export interface DecisionRequestFilter {
  status?: DecisionRequestStatus;
  taskId?: string;
  assignedMembershipId?: string;
  /** Agent/skill visibility applied in the query before the page limit; omitted means unrestricted. */
  scope?: Array<{ agentId: string; skillId: string | null }>;
}

/** Repository methods run inside the unit-of-work transaction supplied by the caller. */
export interface DecisionRepository {
  /** Locks the request row for the rest of the transaction. */
  lockRequest(organizationId: string, id: string): Promise<DecisionRequestRecord | undefined>;
  findRequest(organizationId: string, id: string): Promise<DecisionRequestRecord | undefined>;
  /** Idempotent on (organization, requestKey): a repeated open returns the original request. */
  insertRequest(request: DecisionRequestRecord, firstRevision: DecisionRevisionRecord): Promise<{ request: DecisionRequestRecord; created: boolean }>;
  /** Persists status, assignment and current revision; revisions and decisions are never updated. */
  updateRequest(request: DecisionRequestRecord): Promise<DecisionRequestRecord>;
  listRequests(organizationId: string, filter: DecisionRequestFilter, limit: number): Promise<DecisionRequestRecord[]>;
  /** Open (pending or changes-requested) requests for a task, locked in id order. */
  lockActiveForTask(organizationId: string, taskId: string): Promise<DecisionRequestRecord[]>;
  dueForExpiry(now: Date, limit: number): Promise<DecisionRequestRecord[]>;
  revisions(organizationId: string, requestId: string): Promise<DecisionRevisionRecord[]>;
  appendRevision(revision: DecisionRevisionRecord): Promise<DecisionRevisionRecord>;
  decisions(organizationId: string, requestId: string): Promise<DecisionRecord[]>;
  findDecisionByKey(organizationId: string, idempotencyKey: string): Promise<DecisionRecord | undefined>;
  insertDecision(decision: DecisionRecord): Promise<DecisionRecord>;
  insertExecution(execution: DecisionExecutionRecord): Promise<DecisionExecutionRecord>;
  findExecutionByDecision(organizationId: string, decisionId: string): Promise<DecisionExecutionRecord | undefined>;
  updateExecution(execution: DecisionExecutionRecord): Promise<DecisionExecutionRecord>;
}

export interface DecisionCommandInput {
  organizationId: string;
  agentId: string;
  tenant: string;
  skillId: string | null;
  idempotencyKey: string;
  messageId: string;
  taskRemoteId: string;
  contextId: string | null;
  text: string;
  data?: Record<string, unknown>;
}

export interface DecisionPorts {
  decisions: DecisionRepository;
  tasks: { findById(organizationId: string, id: string): Promise<TaskRecord | undefined> };
  commands: { findById(organizationId: string, id: string): Promise<TaskCommandRecord | undefined> };
  /** Throws an authorization error unless the principal may operate the agent/skill. */
  requireOperate(principal: Principal, agentId: string, skillId: string | null): Promise<void>;
  canRead(principal: Principal, agentId: string, skillId: string | null): Promise<boolean>;
  /** True when the membership is currently enabled, operator-capable and granted the agent/skill. */
  canOperate(organizationId: string, membershipId: string, agentId: string, skillId: string | null): Promise<boolean>;
  /** Command intent and outbox row commit with the surrounding transaction. */
  acceptCommand(input: DecisionCommandInput): Promise<TaskCommandRecord>;
  audit(principal: Principal | null, organizationId: string, action: string, targetId: string, eventKey: string): Promise<void>;
}

export interface DecisionUnitOfWork {
  run<T>(work: (ports: DecisionPorts) => Promise<T>): Promise<T>;
}
