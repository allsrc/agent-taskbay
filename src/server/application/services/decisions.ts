import { randomUUID } from "node:crypto";
import type {
  DecisionExecutionRecord, DecisionOutcome, DecisionPolicy, DecisionRecord, DecisionRequestRecord, DecisionRequestStatus,
  DecisionRevisionRecord, DecisionRisk, ProposedAction,
} from "../../domain/decision-model";
import type { Principal } from "../ports/identity";
import type { DecisionPorts, DecisionUnitOfWork } from "../ports/decisions";
import type { Clock } from "../ports/clock";
import { authorize } from "./authorization";
import { eventDigest } from "./event-identity";
import type { JsonValue } from "../../domain/persistence-model";

export class DecisionError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export const MAX_DECISION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const ALL_OUTCOMES: DecisionOutcome[] = ["approve", "reject", "edit", "request_changes", "delegate"];
export const DEFAULT_POLICY: DecisionPolicy = { allowedOutcomes: ALL_OUTCOMES, separationOfDuties: true };
const TERMINAL_STATES = ["COMPLETED", "FAILED", "CANCELED", "REJECTED"];
const MAX_ACTION_DATA_BYTES = 64 * 1024;

export function actionDigest(action: ProposedAction) {
  return eventDigest({ kind: action.kind, text: action.text, data: (action.data ?? null) as JsonValue });
}

export function validateAction(action: ProposedAction): ProposedAction {
  if (action?.kind !== "send_message" || typeof action.text !== "string" || !action.text.trim() || action.text.length > 20_000)
    throw new DecisionError("A proposed action needs a send_message kind and 1–20000 characters of text.", 400);
  if (action.data !== undefined && (typeof action.data !== "object" || action.data === null || Array.isArray(action.data) ||
    JSON.stringify(action.data).length > MAX_ACTION_DATA_BYTES)) throw new DecisionError("Proposed action data is invalid or too large.", 400);
  return { kind: "send_message", text: action.text, ...(action.data ? { data: action.data } : {}) };
}

function terminalTask(task: { state: string; terminalAt: Date | null }) {
  return task.terminalAt !== null || TERMINAL_STATES.includes(task.state.replace("TASK_STATE_", ""));
}
const ACTIVE = ["pending", "changes_requested"];

export interface OpenDecisionInput {
  principal: Principal;
  taskId: string;
  requestKey: string;
  title: string;
  summary: string;
  risk: DecisionRisk;
  action: ProposedAction;
  expiresAt: Date;
  policy?: Partial<DecisionPolicy>;
  assignedMembershipId?: string | null;
}

export interface DecideInput {
  principal: Principal;
  requestId: string;
  outcome: DecisionOutcome;
  rationale: string;
  /** The revision number the reviewer actually saw; a newer revision invalidates the decision. */
  expectedRevision: number;
  idempotencyKey: string;
  edit?: ProposedAction;
  delegateMembershipId?: string;
}

export type DecideResult =
  | { kind: "decided"; request: DecisionRequestRecord; decision: DecisionRecord; execution: DecisionExecutionRecord | null; replay: boolean }
  /** The refusal itself is durable (the request is now expired/superseded); callers report an error after commit. */
  | { kind: "refused"; reason: "expired" | "superseded"; request: DecisionRequestRecord };

export class DecisionService {
  constructor(private readonly work: DecisionUnitOfWork, private readonly clock: Clock = { now: () => new Date() }) {}

  async open(input: OpenDecisionInput) {
    authorize(input.principal, "operate");
    if (!input.requestKey || input.requestKey.length > 255) throw new DecisionError("A request key of 1–255 characters is required.", 400);
    if (!input.title.trim() || input.title.length > 300 || input.summary.length > 4000) throw new DecisionError("Invalid decision title or summary.", 400);
    if (!["low", "medium", "high"].includes(input.risk)) throw new DecisionError("Invalid risk.", 400);
    const action = validateAction(input.action);
    const now = this.clock.now();
    if (input.expiresAt <= now || input.expiresAt.getTime() - now.getTime() > MAX_DECISION_LIFETIME_MS)
      throw new DecisionError("Expiry must be in the future and within 30 days.", 400);
    const allowed = (input.policy?.allowedOutcomes ?? ALL_OUTCOMES).filter((outcome) => ALL_OUTCOMES.includes(outcome));
    if (!allowed.includes("approve") && !allowed.includes("edit")) throw new DecisionError("A policy must allow an approving outcome.", 400);
    const policy: DecisionPolicy = { allowedOutcomes: [...new Set(allowed)], separationOfDuties: input.policy?.separationOfDuties ?? true };
    return this.work.run(async (ports) => {
      const task = await ports.tasks.findById(input.principal.organizationId, input.taskId);
      if (!task) throw new DecisionError("Task not found.", 404);
      if (task.kind !== "task" || !task.remoteTaskId) throw new DecisionError("Decisions apply only to A2A tasks.", 409);
      await ports.requireOperate(input.principal, task.agentId, task.skillId ?? null);
      if (terminalTask(task)) throw new DecisionError("The task is already finished.", 409);
      if (input.assignedMembershipId && !await ports.canOperate(task.organizationId, input.assignedMembershipId, task.agentId, task.skillId ?? null))
        throw new DecisionError("The assignee cannot operate this agent.", 422);
      const id = randomUUID();
      const request: DecisionRequestRecord = {
        id, organizationId: task.organizationId, taskId: task.id, agentId: task.agentId, tenant: task.tenant, skillId: task.skillId ?? null,
        kind: "send_message", status: "pending", requestKey: input.requestKey, title: input.title.trim(), summary: input.summary, risk: input.risk,
        policy, requesterUserId: input.principal.userId, assignedMembershipId: input.assignedMembershipId ?? null, currentRevision: 1,
        expiresAt: input.expiresAt, createdAt: now, updatedAt: now, version: 1,
      };
      const revision: DecisionRevisionRecord = { id: randomUUID(), organizationId: task.organizationId, requestId: id, number: 1, action,
        digest: actionDigest(action), authorType: "user", authorUserId: input.principal.userId, createdAt: now };
      const result = await ports.decisions.insertRequest(request, revision);
      if (!result.created) {
        // A repeated open must describe the same intent; otherwise the key is being reused.
        const [first] = await ports.decisions.revisions(task.organizationId, result.request.id);
        if (result.request.taskId !== task.id || first?.digest !== revision.digest) throw new DecisionError("This request key already belongs to a different request.", 409);
        return { request: result.request, created: false };
      }
      // Only one approval may be live per task: older open requests can no longer authorize anything.
      for (const older of await ports.decisions.lockActiveForTask(task.organizationId, task.id)) {
        if (older.id === id) continue;
        await ports.decisions.updateRequest({ ...older, status: "superseded", updatedAt: now });
        await ports.audit(input.principal, task.organizationId, "decision.superseded", older.id, `decision-superseded:${older.id}`);
      }
      await ports.audit(input.principal, task.organizationId, "decision.requested", id, `decision-requested:${id}`);
      return { request: result.request, created: true };
    });
  }

  /** The proposer (or an operator) submits a new revision; any earlier review no longer applies. */
  async revise(input: { principal: Principal; requestId: string; action: ProposedAction; expectedRevision: number }) {
    authorize(input.principal, "operate");
    const action = validateAction(input.action);
    return this.work.run(async (ports) => {
      const request = await ports.decisions.lockRequest(input.principal.organizationId, input.requestId);
      if (!request) throw new DecisionError("Decision request not found.", 404);
      // Without a read grant the request does not exist for this reviewer; with one, operate is still required.
      if (!await ports.canRead(input.principal, request.agentId, request.skillId)) throw new DecisionError("Decision request not found.", 404);
      await ports.requireOperate(input.principal, request.agentId, request.skillId);
      const now = this.clock.now();
      if (!ACTIVE.includes(request.status)) throw new DecisionError("This request is closed.", 409);
      if (now >= request.expiresAt) throw new DecisionError("This request has expired.", 409);
      if (input.expectedRevision !== request.currentRevision) throw new DecisionError("The request changed; reload it.", 409);
      const revision: DecisionRevisionRecord = { id: randomUUID(), organizationId: request.organizationId, requestId: request.id,
        number: request.currentRevision + 1, action, digest: actionDigest(action), authorType: "user",
        authorUserId: input.principal.userId, createdAt: now };
      await ports.decisions.appendRevision(revision);
      const updated = await ports.decisions.updateRequest({ ...request, status: "pending", currentRevision: revision.number, updatedAt: now });
      await ports.audit(input.principal, request.organizationId, "decision.revised", revision.id, `decision-revised:${revision.id}`);
      return { request: updated, revision };
    });
  }

  async decide(input: DecideInput): Promise<DecideResult> {
    authorize(input.principal, "operate");
    if (!ALL_OUTCOMES.includes(input.outcome)) throw new DecisionError("Unknown decision outcome.", 400);
    if (!input.idempotencyKey || input.idempotencyKey.length > 255) throw new DecisionError("An idempotency key of 1–255 characters is required.", 400);
    if (typeof input.rationale !== "string" || input.rationale.length > 4000 ||
      (input.outcome !== "approve" && !input.rationale.trim())) throw new DecisionError("A rationale is required for this decision.", 400);
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) throw new DecisionError("expectedRevision is required.", 400);
    if (input.outcome === "edit" && !input.edit) throw new DecisionError("An edit needs the edited action.", 400);
    if (input.outcome === "delegate" && !input.delegateMembershipId) throw new DecisionError("A delegation needs a delegate.", 400);
    if (input.outcome !== "edit" && input.edit) throw new DecisionError("Only an edit carries edited content.", 400);
    if (input.outcome !== "delegate" && input.delegateMembershipId) throw new DecisionError("Only a delegation names a delegate.", 400);
    const edit = input.edit ? validateAction(input.edit) : undefined;
    const inputDigest = eventDigest({ requestId: input.requestId, outcome: input.outcome, rationale: input.rationale,
      expectedRevision: input.expectedRevision, edit: (edit ?? null) as JsonValue, delegate: input.delegateMembershipId ?? null });

    return this.work.run(async (ports): Promise<DecideResult> => {
      const org = input.principal.organizationId;
      const request = await ports.decisions.lockRequest(org, input.requestId);
      if (!request) throw new DecisionError("Decision request not found.", 404);
      // Without a read grant the request does not exist for this reviewer; with one, operate is still required.
      if (!await ports.canRead(input.principal, request.agentId, request.skillId)) throw new DecisionError("Decision request not found.", 404);
      await ports.requireOperate(input.principal, request.agentId, request.skillId);

      // A replay of the same decision returns the original outcome and never dispatches again.
      const prior = await ports.decisions.findDecisionByKey(org, input.idempotencyKey);
      if (prior) {
        if (prior.requestId !== request.id || prior.inputDigest !== inputDigest || prior.reviewerUserId !== input.principal.userId)
          throw new DecisionError("This idempotency key already belongs to a different decision.", 409);
        return { kind: "decided", request, decision: prior, execution: await ports.decisions.findExecutionByDecision(org, prior.id) ?? null, replay: true };
      }

      const now = this.clock.now();
      if (!ACTIVE.includes(request.status)) throw new DecisionError(`This request is already ${request.status.replace("_", " ")}.`, 409);
      if (now >= request.expiresAt) {
        const expired = await ports.decisions.updateRequest({ ...request, status: "expired", updatedAt: now });
        await ports.audit(null, org, "decision.expired", request.id, `decision-expired:${request.id}`);
        return { kind: "refused", reason: "expired", request: expired };
      }
      const task = await ports.tasks.findById(org, request.taskId);
      if (!task || terminalTask(task) || !task.remoteTaskId) {
        const superseded = await ports.decisions.updateRequest({ ...request, status: "superseded", updatedAt: now });
        await ports.audit(null, org, "decision.superseded", request.id, `decision-superseded:${request.id}`);
        return { kind: "refused", reason: "superseded", request: superseded };
      }
      if (request.status !== "pending") throw new DecisionError("Awaiting a revised proposal before it can be decided.", 409);
      if (!request.policy.allowedOutcomes.includes(input.outcome)) throw new DecisionError("Policy does not allow this outcome.", 403);
      if (request.policy.separationOfDuties && request.requesterUserId === input.principal.userId) throw new DecisionError("The requester cannot decide their own request.", 403);
      if (request.assignedMembershipId && request.assignedMembershipId !== input.principal.membershipId && input.principal.role !== "admin")
        throw new DecisionError("This request is assigned to someone else.", 403);
      if (input.expectedRevision !== request.currentRevision) throw new DecisionError("A newer revision exists; review it before deciding.", 409);

      const revisions = await ports.decisions.revisions(org, request.id);
      let revision = revisions.find((candidate) => candidate.number === request.currentRevision);
      if (!revision) throw new DecisionError("Decision revision is missing.", 500);
      if (input.outcome === "delegate" && (input.delegateMembershipId === input.principal.membershipId ||
        !await ports.canOperate(org, input.delegateMembershipId!, request.agentId, request.skillId)))
        throw new DecisionError("The delegate cannot operate this agent.", 422);
      if (edit && actionDigest(edit) === revision.digest) throw new DecisionError("The edit does not change the proposal.", 422);

      let nextStatus: DecisionRequestStatus = request.status;
      let nextRevision = request.currentRevision;
      let assigned = request.assignedMembershipId;
      if (input.outcome === "edit") {
        revision = { id: randomUUID(), organizationId: org, requestId: request.id, number: request.currentRevision + 1, action: edit!,
          digest: actionDigest(edit!), authorType: "user", authorUserId: input.principal.userId, createdAt: now };
        await ports.decisions.appendRevision(revision);
        nextRevision = revision.number;
      }
      if (input.outcome === "approve" || input.outcome === "edit") nextStatus = "approved";
      else if (input.outcome === "reject") nextStatus = "rejected";
      else if (input.outcome === "request_changes") nextStatus = "changes_requested";
      else assigned = input.delegateMembershipId!;

      const decision = await ports.decisions.insertDecision({
        id: randomUUID(), organizationId: org, requestId: request.id, revisionId: revision.id, revisionDigest: revision.digest,
        outcome: input.outcome, rationale: input.rationale, reviewerUserId: input.principal.userId,
        reviewerMembershipId: input.principal.membershipId, delegateMembershipId: input.delegateMembershipId ?? null,
        idempotencyKey: input.idempotencyKey, inputDigest, policy: request.policy, createdAt: now,
      });
      const updated = await ports.decisions.updateRequest({ ...request, status: nextStatus, currentRevision: nextRevision, assignedMembershipId: assigned, updatedAt: now });

      let execution: DecisionExecutionRecord | null = null;
      if (nextStatus === "approved") {
        // The command carries exactly the approved revision's content, addressed by the request's own scope.
        const messageId = `decision-${decision.id}`;
        const command = await ports.acceptCommand({ organizationId: org, agentId: request.agentId, tenant: request.tenant, skillId: request.skillId,
          idempotencyKey: `decision:${decision.id}`, messageId, taskRemoteId: task.remoteTaskId, contextId: task.remoteContextId,
          text: revision.action.text, data: revision.action.data });
        execution = await ports.decisions.insertExecution({ id: randomUUID(), organizationId: org, decisionId: decision.id, revisionId: revision.id,
          revisionDigest: revision.digest, commandId: command.id, messageId: command.messageId, status: "pending", observedTaskState: null,
          observedAt: null, lastError: null, createdAt: now, updatedAt: now });
      }
      await ports.audit(input.principal, org, `decision.${input.outcome}`, decision.id, `decision:${decision.id}`);
      return { kind: "decided", request: updated, decision, execution, replay: false };
    });
  }

  /** Read-through correlation of the approved revision with command dispatch and the observed task state. */
  async refreshExecution(organizationId: string, decisionId: string) {
    return this.work.run(async (ports) => {
      const execution = await ports.decisions.findExecutionByDecision(organizationId, decisionId);
      if (!execution) return undefined;
      const command = await ports.commands.findById(organizationId, execution.commandId);
      if (!command) return execution;
      const status = command.status;
      const now = this.clock.now();
      const result = command.resultJson as { localId?: string } | null;
      const task = status === "succeeded" && result?.localId ? await ports.tasks.findById(organizationId, result.localId) : undefined;
      if (status === execution.status && (task?.state ?? null) === execution.observedTaskState) return execution;
      return ports.decisions.updateExecution({ ...execution, status, lastError: command.lastError,
        observedTaskState: task?.state ?? execution.observedTaskState, observedAt: task ? now : execution.observedAt, updatedAt: now });
    });
  }

  /** Expires open requests whose deadline passed. Workers call this; reviewers also discover expiry on decide. */
  async expireDue(limit = 100) {
    const now = this.clock.now();
    return this.work.run(async (ports) => {
      let expired = 0;
      for (const due of await ports.decisions.dueForExpiry(now, limit)) {
        const locked = await ports.decisions.lockRequest(due.organizationId, due.id);
        if (!locked || !ACTIVE.includes(locked.status) || locked.expiresAt > now) continue;
        await ports.decisions.updateRequest({ ...locked, status: "expired", updatedAt: now });
        await ports.audit(null, locked.organizationId, "decision.expired", locked.id, `decision-expired:${locked.id}`);
        expired += 1;
      }
      return expired;
    });
  }
}

export async function loadDecisionDetail(ports: DecisionPorts, organizationId: string, id: string) {
  const request = await ports.decisions.findRequest(organizationId, id);
  if (!request) return undefined;
  const [revisions, decisions] = await Promise.all([ports.decisions.revisions(organizationId, id), ports.decisions.decisions(organizationId, id)]);
  const executions = (await Promise.all(decisions.map((decision) => ports.decisions.findExecutionByDecision(organizationId, decision.id))))
    .filter((execution): execution is DecisionExecutionRecord => Boolean(execution));
  return { request, revisions, decisions, executions };
}
