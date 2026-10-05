import { requestAccessPolicy } from "../adapters/db/security-repository";
import { SKILL_ROUTING_EXTENSION } from "../application/services/access-policy";
import { randomUUID } from "node:crypto";
import type { EntityManager, MikroORM } from "@mikro-orm/core";
import { z } from "zod";
import type { JsonValue, TaskCommandRecord } from "../domain/persistence-model";
import { withRequestEntityManager, withJobEntityManager } from "../adapters/db/orm";
import { createPersistenceRepositories } from "../adapters/db/repositories";
import { bootstrapDefaultLocalOrganization } from "../application/services/bootstrap-default-organization";
import { TaskCommandService, CommandError } from "../application/services/task-command";
import { CommandDispatcher } from "../application/services/dispatch-command";
import type { A2ACommandGateway, CommandUnitOfWork } from "../application/ports/command-dispatch";
import type { ArtifactStore } from "../application/ports/artifact-store";
import { SdkCommandGateway } from "../adapters/a2a/command-gateway";
import { artifactStore, createTaskObserver } from "./task-persistence";
import { eventDigest } from "../application/services/observe-task";
import { currentPrincipal } from "../adapters/auth/principal-context";
import { authorize } from "../application/services/authorization";
import { DatabaseIdentityRepository } from "../adapters/db/identity-repository";

export function compatibilityCommandKey(agentId: string, tenant = "", messageId?: string) {
  return messageId ? `message:${eventDigest({ agentId, tenant, messageId })}` : randomUUID();
}

const config = z.object({ returnImmediately: z.boolean().optional(), historyLength: z.number().int().nonnegative().optional(),
  acceptedOutputModes: z.array(z.string()).optional(), referenceTaskIds: z.array(z.string()).optional(), extensions: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(), requestMetadata: z.record(z.string(), z.unknown()).optional() }).strict();
export const commandInputSchema = z.object({ action: z.enum(["send", "cancelTask"]).default("send"),
  skillId: z.string().min(1).max(255).optional(),
  tenant: z.string().max(255).default(""), messageId: z.string().min(1).max(255).optional(),
  text: z.string().optional(), parts: z.array(z.record(z.string(), z.unknown())).optional(),
  taskId: z.string().min(1).optional(), contextId: z.string().optional(), config: config.optional(),
}).strict().superRefine((input, ctx) => {
  if (input.action === "send" && !input.text?.trim() && !input.parts?.length) ctx.addIssue({ code: "custom", message: "A message needs at least one content part." });
  if (input.action === "cancelTask" && !input.taskId) ctx.addIssue({ code: "custom", message: "taskId is required for cancellation." });
});

export function commandView(command: TaskCommandRecord) {
  return { id: command.id, agentId: command.agentId, tenant: command.tenant, action: command.action,
    messageId: command.messageId, status: command.status, result: command.resultJson, error: command.lastError,
    createdAt: command.createdAt.toISOString(), updatedAt: command.updatedAt.toISOString() };
}

export interface AcceptCommandScope {
  organizationId: string;
  agentId: string;
  action: "send" | "cancelTask";
  tenant: string;
  skillId?: string;
  config?: z.infer<typeof config>;
  input: { text?: string; parts?: Array<Record<string, unknown>>; taskId?: string; contextId?: string; messageId?: string };
  params: Record<string, JsonValue>;
  idempotencyKey: string;
  store?: ArtifactStore;
}

/** Validates scope/policy and records command intent plus its outbox row in the caller's transaction. */
export async function acceptCommandWithin(transaction: EntityManager, scope: AcceptCommandScope) {
  const { organizationId, agentId, tenant, action, config, input, params, idempotencyKey, skillId: requestedSkillId } = scope;
  const principal = currentPrincipal();
  const organization = { id: organizationId };
  const ports = createPersistenceRepositories(transaction);
  if (!(await ports.agents.findById(organization.id, agentId))?.enabled) throw new CommandError("Unknown agent.", 404);
  let skillId = requestedSkillId ?? null;
  const policy = await requestAccessPolicy(transaction);
  const task = input.taskId ? await ports.tasks.findByRemoteIdentity({organizationId: organization.id, agentId, tenant, remoteTaskId: input.taskId}) : undefined;
  if (input.taskId && !task) throw new CommandError("Task not found.", 404);
  if (task) {
    if (requestedSkillId && requestedSkillId !== task.skillId) throw new CommandError("Task skill cannot be changed.", 403);
    skillId = task.skillId ?? null;
    if (input.contextId && input.contextId !== task.remoteContextId) throw new CommandError("Task context mismatch.", 403);
  }
  policy?.require(agentId, "operate", skillId);
  for (const remoteTaskId of config?.referenceTaskIds ?? []) {
    if (!await ports.tasks.findByRemoteIdentity({ organizationId: organization.id, agentId, tenant, remoteTaskId }))
      throw new CommandError("Referenced task not found.", 404);
  }
  if (params.metadata && typeof params.metadata === "object" && !Array.isArray(params.metadata))
    delete params.metadata[SKILL_ROUTING_EXTENSION];

  if (policy && !policy.allows(agentId, "operate") && !task && input.contextId) throw new CommandError("A skill-scoped send must start a new context.", 403);
  if (skillId !== null) {
    const snapshot = await ports.agents.findLatestCardSnapshot(agentId);
    const card = snapshot?.normalizedCardJson as {skills?: Array<{id?: string}>; capabilities?: {extensions?: Array<{uri?: string}>}} | undefined;
    if (!card?.skills?.some((skill) => skill.id === skillId) ||
      !card.capabilities?.extensions?.some((extension) => extension.uri === SKILL_ROUTING_EXTENSION))
      throw new CommandError("This agent does not support bounded skill routing.", 403);
    params.skillId = skillId;
    params.extensions = [...new Set([...(Array.isArray(params.extensions) ? params.extensions : []), SKILL_ROUTING_EXTENSION])];
    params.requestMetadata = { ...(params.requestMetadata as Record<string, JsonValue> ?? {}), [SKILL_ROUTING_EXTENSION]: {skillId} };
  }
  // Scope-bearing routing metadata is constructed by the server, never accepted independently from callers.
  if (skillId === null && params.requestMetadata && typeof params.requestMetadata === "object" && !Array.isArray(params.requestMetadata))
    delete params.requestMetadata[SKILL_ROUTING_EXTENSION];
  const command = await new TaskCommandService(ports.agents, ports.commands, ports.outbox, scope.store ?? artifactStore).accept({
    organizationId: organization.id, agentId, tenant, skillId, action, idempotencyKey, params,
  });
  if (principal) await new DatabaseIdentityRepository(transaction).appendAudit(principal,
    action === "send" ? "task.send.accepted" : "task.cancel.accepted", command.id, `command:${command.id}`);
  return command;
}

export async function acceptCommand(agentId: string, body: unknown, idempotencyKey: string, options: { orm?: MikroORM; store?: ArtifactStore } = {}) {
  const parsed = commandInputSchema.safeParse(body);
  if (!parsed.success) throw new CommandError(parsed.error.issues.map((issue) => issue.message).join("; "), 400);
  const { action, tenant, skillId: requestedSkillId, config, ...input } = parsed.data;
  // Initial sends return a snapshot; the worker observes open tasks independently.
  const params = JSON.parse(JSON.stringify({ ...input, returnImmediately: true, ...config })) as Record<string, JsonValue>;
  return withRequestEntityManager(async (em) => {
    const principal = currentPrincipal();
    if (principal) authorize(principal, "operate");
    const organizations = createPersistenceRepositories(em).organizations;
    const organization = principal ? await organizations.findById(principal.organizationId) : await bootstrapDefaultLocalOrganization(organizations);
    if (!organization) throw new CommandError("Unknown organization.", 404);
    return em.transactional(async (transaction) => {
      const command = await acceptCommandWithin(transaction, { organizationId: organization.id, agentId, action, tenant, skillId: requestedSkillId,
        config, input, params, idempotencyKey, store: options.store });
      return command;
    });
  }, options.orm);
}

export async function readCommand(id: string, orm?: MikroORM) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return undefined;
  return withRequestEntityManager(async (em) => {
    const ports = createPersistenceRepositories(em);
    const principal = currentPrincipal();
    const org = principal ? await ports.organizations.findById(principal.organizationId) : await bootstrapDefaultLocalOrganization(ports.organizations);
    if (!org) return;
    const command = await ports.commands.findById(org.id, id);
    const policy = await requestAccessPolicy(em);
    return command && (!policy || policy.allows(command.agentId, "read", command.skillId ?? null)) ? command : undefined;
  }, orm);
}

export function createCommandDispatcher(options: { orm?: MikroORM; store?: ArtifactStore; gateway?: A2ACommandGateway; owner?: string } = {}) {
  const owner = options.owner ?? randomUUID();
  const work: CommandUnitOfWork = { run: (callback) => withJobEntityManager((em) =>
    em.transactional((transaction) => callback(createPersistenceRepositories(transaction))), options.orm) };
  return new CommandDispatcher(work, options.gateway ?? new SdkCommandGateway(), options.store ?? artifactStore, {
    commit: async (message, command, event, userMessage) => {
      await createTaskObserver({ organizationId: command.organizationId, agentId: command.agentId, tenant: command.tenant, sessionId: command.id,
        requestId: command.id, source: "command_response", userMessage, skillId: command.skillId }, { orm: options.orm, store: options.store,
        onObserved: async (view, safeEvent, transaction) => {
          const ports = createPersistenceRepositories(transaction);
          const now = new Date();
          if (!await ports.outbox.finish(message.id, command.organizationId, owner, now,
            { status: "processed", processedAt: now, availableAt: now, lastError: null })) throw new Error("Dispatch lease lost before completion.");
          await ports.commands.update(command.organizationId, command.id, { status: "succeeded", lastError: null, updatedAt: now,
            resultJson: { event: safeEvent, localId: view.localId, taskId: view.taskId, tenant: view.tenant } });
        },
      })(event);
    },
  }, owner);
}

export async function waitForCommand(id: string, signal?: AbortSignal) {
  const deadline = Date.now() + 50_000;
  while (!signal?.aborted && Date.now() < deadline) {
    const command = await readCommand(id);
    if (!command) throw new CommandError("Command not found.", 404);
    if (command.status === "succeeded") return command;
    if (["failed", "uncertain"].includes(command.status)) throw new CommandError(command.lastError ?? "Command failed.", 409);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new CommandError(`Command accepted; waiting stopped. Query /api/commands/${id} for its outcome before submitting again.`, 504);
}

export function legacyCommandResponse(command: TaskCommandRecord) {
  const result = command.resultJson as { event: Record<string, JsonValue>; localId: string };
  return { result: result.event.task ?? result.event.message, localId: result.localId, commandId: command.id,
    sessionId: command.id, requestId: command.id, telemetry: [] };
}
