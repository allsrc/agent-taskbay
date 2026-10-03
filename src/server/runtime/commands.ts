import { randomUUID } from "node:crypto";
import type { MikroORM } from "@mikro-orm/core";
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

export function compatibilityCommandKey(agentId: string, tenant = "", messageId?: string) {
  return messageId ? `message:${eventDigest({ agentId, tenant, messageId })}` : randomUUID();
}

const config = z.object({ returnImmediately: z.boolean().optional(), historyLength: z.number().int().nonnegative().optional(),
  acceptedOutputModes: z.array(z.string()).optional(), referenceTaskIds: z.array(z.string()).optional(), extensions: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(), requestMetadata: z.record(z.string(), z.unknown()).optional() }).strict();
export const commandInputSchema = z.object({ action: z.enum(["send", "cancelTask"]).default("send"),
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

export async function acceptCommand(agentId: string, body: unknown, idempotencyKey: string, options: { orm?: MikroORM; store?: ArtifactStore } = {}) {
  const parsed = commandInputSchema.safeParse(body);
  if (!parsed.success) throw new CommandError(parsed.error.issues.map((issue) => issue.message).join("; "), 400);
  const { action, tenant, config, ...input } = parsed.data;
  // Initial sends return a snapshot; the worker observes open tasks independently.
  const params = JSON.parse(JSON.stringify({ ...input, returnImmediately: true, ...config })) as Record<string, JsonValue>;
  return withRequestEntityManager(async (em) => {
    const organization = await bootstrapDefaultLocalOrganization(createPersistenceRepositories(em).organizations);
    return em.transactional(async (transaction) => {
      const ports = createPersistenceRepositories(transaction);
      return new TaskCommandService(ports.agents, ports.commands, ports.outbox, options.store ?? artifactStore).accept({
        organizationId: organization.id, agentId, tenant, action, idempotencyKey, params,
      });
    });
  }, options.orm);
}

export async function readCommand(id: string, orm?: MikroORM) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return undefined;
  return withRequestEntityManager(async (em) => {
    const ports = createPersistenceRepositories(em);
    const org = await bootstrapDefaultLocalOrganization(ports.organizations);
    return ports.commands.findById(org.id, id);
  }, orm);
}

export function createCommandDispatcher(options: { orm?: MikroORM; store?: ArtifactStore; gateway?: A2ACommandGateway; owner?: string } = {}) {
  const owner = options.owner ?? randomUUID();
  const work: CommandUnitOfWork = { run: (callback) => withJobEntityManager((em) =>
    em.transactional((transaction) => callback(createPersistenceRepositories(transaction))), options.orm) };
  return new CommandDispatcher(work, options.gateway ?? new SdkCommandGateway(), options.store ?? artifactStore, {
    commit: async (message, command, event, userMessage) => {
      await createTaskObserver({ organizationId: command.organizationId, agentId: command.agentId, tenant: command.tenant, sessionId: command.id,
        requestId: command.id, source: "command_response", userMessage }, { orm: options.orm, store: options.store,
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
