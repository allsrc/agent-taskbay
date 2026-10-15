import { randomUUID } from "node:crypto";
import type { MikroORM } from "@mikro-orm/core";
import { withRequestEntityManager } from "../adapters/db/orm";
import { createPersistenceRepositories } from "../adapters/db/repositories";
import { requestAccessPolicy, takeRateLimit } from "../adapters/db/security-repository";
import { currentPrincipal } from "../adapters/auth/principal-context";
import { SdkReconciliationGateway } from "../adapters/a2a/reconciliation-gateway";
import { classifyRemoteError } from "../adapters/a2a/remote-error-map";
import { bootstrapDefaultLocalOrganization } from "../application/services/bootstrap-default-organization";
import { authorize } from "../application/services/authorization";
import { validateReconciledTask } from "../application/services/reconcile-task";
import type { A2AReconciliationGateway } from "../application/ports/reconciliation";
import type { ArtifactStore } from "../application/ports/artifact-store";
import type { DurableTaskView } from "../../shared/task-types";
import { artifactStore, createTaskObserver, withTaskQueries } from "./task-persistence";

export const DEFAULT_HISTORY_LENGTH = 50;
export const MAX_HISTORY_LENGTH = 200;
export const HISTORY_LIMIT_PER_MINUTE = 6;
const AGENT_TIMEOUT_MS = 30_000;

/** A refusal to load history. `kind` selects the console's words; the message is Taskbay's own. */
export class TaskHistoryError extends Error {
  constructor(message: string, readonly status: number, readonly kind: string) { super(message); this.name = "TaskHistoryError"; }
}

export interface TaskHistoryOptions { orm?: MikroORM; gateway?: Pick<A2AReconciliationGateway, "get">; store?: ArtifactStore }
export interface TaskHistoryResult {
  task: DurableTaskView;
  /** Messages this load added that Taskbay did not have before. */
  added: number;
  /** All messages now labelled as agent history for this task. */
  total: number;
}

/**
 * Asks the agent for the history it keeps for a task (one `GetTask` with `historyLength`) and stores what it returns through the
 * same ledger path as any other read. Entries Taskbay already has are not duplicated, and only messages nothing else carried are labelled
 * as agent history. Needs operate on the task's agent and skill; a task the person cannot see is "not found".
 */
export async function refreshTaskHistory(taskId: string, input: { historyLength?: number }, options: TaskHistoryOptions = {}): Promise<TaskHistoryResult> {
  const historyLength = input.historyLength ?? DEFAULT_HISTORY_LENGTH;
  if (!Number.isInteger(historyLength) || historyLength < 1 || historyLength > MAX_HISTORY_LENGTH)
    throw new TaskHistoryError(`historyLength must be a whole number from 1 to ${MAX_HISTORY_LENGTH}.`, 400, "invalid_request");
  const principal = currentPrincipal();
  if (principal) authorize(principal, "operate");
  const context = await withRequestEntityManager(async (em) => {
    const ports = createPersistenceRepositories(em);
    const organization = principal ? await ports.organizations.findById(principal.organizationId) : await bootstrapDefaultLocalOrganization(ports.organizations);
    if (!organization) throw new TaskHistoryError("Task not found.", 404, "task_not_found");
    const task = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId) ? await ports.tasks.findById(organization.id, taskId) : undefined;
    // The same answer as any task route for a task the person has no access to.
    if (!task) throw new TaskHistoryError("Task not found.", 404, "task_not_found");
    const policy = await requestAccessPolicy(em);
    if (policy && !policy.allows(task.agentId, "operate", task.skillId ?? null)) throw new TaskHistoryError("You need operate access to this task's agent.", 403, "forbidden");
    if (task.kind !== "task" || !task.remoteTaskId) throw new TaskHistoryError("This conversation has no task on the agent, so there is no history to load.", 409, "no_remote_task");
    const agent = await ports.agents.findById(organization.id, task.agentId);
    if (!agent?.enabled) throw new TaskHistoryError("This agent is not available.", 409, "unknown_agent");
    await takeRateLimit(em, `history:refresh:${task.id}`, HISTORY_LIMIT_PER_MINUTE);
    return { organizationId: organization.id, task, agent };
  }, options.orm);

  let event;
  try {
    event = await (options.gateway ?? new SdkReconciliationGateway()).get(context.agent, context.task, AbortSignal.timeout(AGENT_TIMEOUT_MS), historyLength);
  } catch (error) {
    const refusal = classifyRemoteError(error);
    if (refusal?.kind === "task_not_found") throw new TaskHistoryError("The agent no longer has this task.", 409, "task_not_found");
    if (refusal) throw new TaskHistoryError(`The agent refused the request: ${refusal.kind}.`, 502, refusal.kind);
    throw new TaskHistoryError("The agent could not be reached.", 502, "agent_unavailable");
  }
  // The agent's answer must be about this task, in this tenant and context, before any of it is stored.
  try { validateReconciledTask(event, context.task); } catch { throw new TaskHistoryError("The agent returned something Taskbay could not read.", 502, "agent_response_invalid"); }

  const before = new Set((context.task.contentJson as { messages?: { id: string }[] }).messages?.map((message) => message.id) ?? []);
  await createTaskObserver({ organizationId: context.organizationId, agentId: context.agent.id, tenant: context.task.tenant, sessionId: randomUUID(), requestId: randomUUID(),
    source: "reconcile", historyRefresh: true }, { orm: options.orm, store: options.store ?? artifactStore })(event);
  const task = await withTaskQueries((queries, organizationId) => queries.detail(organizationId, context.task.id), options.orm);
  if (!task) throw new TaskHistoryError("Task not found.", 404, "task_not_found");
  const labelled = task.messages.filter((message) => message.origin === "agent-history");
  return { task, added: labelled.filter((message) => !before.has(message.id)).length, total: labelled.length };
}
