import { randomUUID } from "node:crypto";
import type { MikroORM } from "@mikro-orm/core";
import { withRequestEntityManager } from "../adapters/db/orm";
import { createPersistenceRepositories } from "../adapters/db/repositories";
import { DatabaseIdentityRepository } from "../adapters/db/identity-repository";
import { requestAccessPolicy, takeRateLimit } from "../adapters/db/security-repository";
import { currentPrincipal } from "../adapters/auth/principal-context";
import { SdkRemoteTaskGateway } from "../adapters/a2a/remote-task-gateway";
import { bootstrapDefaultLocalOrganization } from "../application/services/bootstrap-default-organization";
import { remoteTaskRows, validateTrackedTask, type RemoteTaskRow } from "../application/services/remote-task-rows";
import { authorize } from "../application/services/authorization";
import { DiscoveryError, type RemoteTaskGateway } from "../application/ports/remote-tasks";
import { RemoteRejection } from "../application/ports/remote-errors";
import { ListTasksUnsupported } from "../application/ports/reconciliation";
import { effectiveTaskDiscovery, DEFAULT_TASK_DISCOVERY_MODE } from "../domain/discovery-mode";
import { taskDiscoveryCap } from "./runtime-config";
import { artifactStore, createTaskObserver } from "./task-persistence";
import type { ArtifactStore } from "../application/ports/artifact-store";
import { cardDefaultTenant } from "../../lib/connection-interface";
import { object } from "../application/services/task-projection";

export const BROWSE_PAGE_SIZE = 25;
export const MAX_BROWSE_PAGE_SIZE = 50;
const BROWSE_LIMIT_PER_MINUTE = 30;
const TRACK_LIMIT_PER_MINUTE = 20;
const STATUS_FILTER = new Set(["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING", "TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED", "TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"]);

export interface BrowseQuery { tenant?: string; contextId?: string; status?: string; pageToken?: string; pageSize?: number }
export interface BrowseRow extends RemoteTaskRow { tracked: boolean; localId: string | null }
export interface DiscoveryOptions { orm?: MikroORM; gateway?: RemoteTaskGateway; store?: ArtifactStore }

/** Looks up the agent in the caller's organization and checks that this person may browse or track its tasks. */
async function authorizeDiscovery(em: Parameters<Parameters<typeof withRequestEntityManager>[0]>[0], agentId: string, action: "browse" | "track") {
  const principal = currentPrincipal();
  if (principal) authorize(principal, "operate");
  const ports = createPersistenceRepositories(em);
  const organization = principal ? await ports.organizations.findById(principal.organizationId) : await bootstrapDefaultLocalOrganization(ports.organizations);
  if (!organization) throw new DiscoveryError("Unknown organization.", 404, "unknown_agent");
  const agent = await ports.agents.findById(organization.id, agentId);
  if (!agent?.enabled) throw new DiscoveryError("Unknown agent.", 404, "unknown_agent");
  // Browsing shows what the agent's credential can see, which can be more than a skill grant allows, so it needs the whole agent.
  const policy = await requestAccessPolicy(em);
  if (policy && !policy.allows(agent.id, "operate", null)) throw new DiscoveryError("Browsing and tracking an agent's tasks needs access to the whole agent.", 403, "whole_agent_required");
  const mode = effectiveTaskDiscovery(agent.taskDiscovery ?? DEFAULT_TASK_DISCOVERY_MODE, taskDiscoveryCap());
  if (mode === "off") throw new DiscoveryError("Task discovery is turned off for this agent.", 409, "discovery_disabled");
  if (principal) await takeRateLimit(em, `discovery:${action}:${principal.membershipId}:${agent.id}`, action === "browse" ? BROWSE_LIMIT_PER_MINUTE : TRACK_LIMIT_PER_MINUTE);
  return { organizationId: organization.id, agent, principal, ports };
}

/** Lists the agent's tasks now. Nothing is stored and nothing is cached. */
export async function browseRemoteTasks(agentId: string, query: BrowseQuery, options: DiscoveryOptions = {}) {
  let tenant = query.tenant ?? "";
  if (tenant.length > 255 || (query.contextId?.length ?? 0) > 255 || (query.pageToken?.length ?? 0) > 4096) throw new DiscoveryError("A filter is too long.", 400, "invalid_request");
  if (query.status && !STATUS_FILTER.has(query.status)) throw new DiscoveryError("Unknown task state.", 400, "invalid_request");
  const pageSize = Math.min(Math.max(Math.trunc(query.pageSize ?? BROWSE_PAGE_SIZE), 1), MAX_BROWSE_PAGE_SIZE);
  const { organizationId, agent } = await withRequestEntityManager(async (em) => {
    const context = await authorizeDiscovery(em, agentId, "browse");
    return { organizationId: context.organizationId, agent: context.agent };
  }, options.orm);
  const gateway = options.gateway ?? new SdkRemoteTaskGateway();
  let page;
  try {
    page = await gateway.list(agent, { tenant, contextId: query.contextId || undefined, status: query.status, pageToken: query.pageToken, pageSize });
  } catch (error) {
    if (error instanceof ListTasksUnsupported) throw new DiscoveryError("This agent does not support listing tasks.", 501, "listing_unsupported");
    if (error instanceof RemoteRejection) throw new DiscoveryError(`The agent refused the request: ${error.kind}.`, 502, error.kind);
    throw new DiscoveryError("The agent could not be reached.", 502, "agent_unavailable");
  }
  tenant = page.tenant ?? tenant;
  const { rows, dropped } = remoteTaskRows(page.tasks, tenant);
  if (!rows.length && dropped) throw new DiscoveryError("The agent returned tasks Taskbay could not read.", 502, "agent_response_invalid");
  const known = await withRequestEntityManager(async (em) => {
    const ports = createPersistenceRepositories(em);
    const identity = { organizationId, agentId: agent.id, tenant, remoteTaskIds: rows.map((row) => row.taskId) };
    const canonical = await ports.tasks.findManyByRemoteIds(identity);
    const snapshot = tenant ? await ports.agents.findLatestCardSnapshot(agent.id) : undefined;
    const legacy = tenant && cardDefaultTenant(snapshot?.normalizedCardJson) === tenant
      ? await ports.tasks.findManyByRemoteIds({ ...identity, tenant: "" }) : [];
    return [...canonical, ...legacy];
  }, options.orm);
  const byId = new Map<string | null, string>();
  for (const task of known) if (!byId.has(task.remoteTaskId)) byId.set(task.remoteTaskId, task.id);
  const result: BrowseRow[] = rows.map((row) => ({ ...row, tracked: byId.has(row.taskId), localId: byId.get(row.taskId) ?? null }));
  return { rows: result, nextPageToken: page.nextPageToken.length <= 4096 ? page.nextPageToken : "", dropped, tenant };
}

/** Stores one task from the agent and starts following it. Idempotent: a task already stored is returned as it is. */
export async function trackRemoteTask(agentId: string, input: { taskId: string; tenant?: string }, options: DiscoveryOptions = {}) {
  let tenant = input.tenant ?? "";
  if (!input.taskId || input.taskId.length > 255 || tenant.length > 255) throw new DiscoveryError("A task ID of 1 to 255 characters is required.", 400, "invalid_request");
  const context = await withRequestEntityManager(async (em) => {
    const authorized = await authorizeDiscovery(em, agentId, "track");
    const defaultTenant = cardDefaultTenant((await authorized.ports.agents.findLatestCardSnapshot(authorized.agent.id))?.normalizedCardJson);
    const identity = { organizationId: authorized.organizationId, agentId: authorized.agent.id, tenant, remoteTaskId: input.taskId };
    const existing = await authorized.ports.tasks.findByRemoteIdentity(identity) ?? (tenant && tenant === defaultTenant
      ? await authorized.ports.tasks.findByRemoteIdentity({ ...identity, tenant: "" }) : undefined);
    return { organizationId: authorized.organizationId, agent: authorized.agent, principal: authorized.principal, existing: existing?.id };
  }, options.orm);
  if (context.existing) return { localId: context.existing, created: false };

  const gateway = options.gateway ?? new SdkRemoteTaskGateway();
  let event;
  try {
    event = await gateway.get(context.agent, tenant, input.taskId);
  } catch (error) {
    if (error instanceof RemoteRejection && error.kind === "task_not_found") throw new DiscoveryError("The agent does not have a task with that ID.", 404, "task_not_found_on_agent");
    if (error instanceof RemoteRejection) throw new DiscoveryError(`The agent refused the request: ${error.kind}.`, 502, error.kind);
    throw new DiscoveryError("The agent could not be reached.", 502, "agent_unavailable");
  }
  tenant = typeof object(event).tenant === "string" ? String(object(event).tenant) : tenant;
  const invalid = validateTrackedTask(event, input.taskId, tenant);
  if (invalid) throw new DiscoveryError(invalid, 502, "agent_response_invalid");
  // Resolve the default from the fresh gateway read, not a possibly stale stored card. Re-tracking keeps the canonical row.
  const existing = await withRequestEntityManager((em) => createPersistenceRepositories(em).tasks.findByRemoteIdentity({
    organizationId: context.organizationId, agentId: context.agent.id, tenant, remoteTaskId: input.taskId,
  }), options.orm);
  if (existing) return { localId: existing.id, created: false };

  // The browser contributed only an ID. What is stored is what the agent returned, observed like any other task update.
  const view = await createTaskObserver({ organizationId: context.organizationId, agentId: context.agent.id, tenant, sessionId: randomUUID(), requestId: randomUUID(),
    source: "reconcile", origin: "discovered", trackedByUserId: context.principal?.userId ?? null },
  { orm: options.orm, store: options.store ?? artifactStore })(event);
  if (context.principal) await withRequestEntityManager((em) => new DatabaseIdentityRepository(em).appendAudit(context.principal!, "task.discovery.tracked", view.localId,
    `track:${view.localId}`), options.orm);
  return { localId: view.localId, created: true };
}
