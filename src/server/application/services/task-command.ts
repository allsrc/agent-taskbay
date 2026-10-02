import { randomUUID } from "node:crypto";
import type { JsonValue } from "../../domain/persistence-model";
import type { AgentRepository, TaskCommandRepository, OutboxRepository } from "../ports/persistence";
import type { ArtifactStore } from "../ports/artifact-store";
import type { Clock } from "../ports/clock";
import { eventDigest } from "./observe-task";

export const COMMAND_TOPIC = "a2a.command.dispatch";
export class CommandError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
export interface CommandIntent {
  organizationId: string;
  agentId: string;
  tenant: string;
  action: "send" | "cancelTask";
  idempotencyKey: string;
  params: Record<string, JsonValue>;
}

export class TaskCommandService {
  constructor(private readonly agents: AgentRepository, private readonly commands: TaskCommandRepository,
    private readonly outbox: OutboxRepository, private readonly store: ArtifactStore,
    private readonly clock: Clock = { now: () => new Date() }) {}

  /** Caller supplies a transaction for command intent and its outbox row. */
  async accept(input: CommandIntent) {
    if (!input.idempotencyKey || input.idempotencyKey.length > 255) throw new CommandError("An idempotency key of 1–255 characters is required.", 400);
    const agent = await this.agents.findById(input.organizationId, input.agentId);
    if (!agent?.enabled) throw new CommandError("Unknown or disabled agent.", 404);
    const now = this.clock.now();
    const messageId = typeof input.params.messageId === "string" && input.params.messageId ? input.params.messageId : randomUUID();
    const payloadDigest = eventDigest({ agentId: input.agentId, tenant: input.tenant, action: input.action, params: input.params });
    const stored = await this.store.put(input.organizationId, Buffer.from(JSON.stringify({ ...input.params, tenant: input.tenant, messageId })));
    const { command, created } = await this.commands.getOrCreate({
      id: randomUUID(), organizationId: input.organizationId, agentId: input.agentId,
      tenant: input.tenant, action: input.action, idempotencyKey: input.idempotencyKey, messageId,
      payloadDigest, payloadObjectKey: stored.objectKey, status: "pending", resultJson: null, lastError: null, createdAt: now, updatedAt: now,
    });
    if (command.payloadDigest !== payloadDigest) throw new CommandError("This idempotency key already belongs to different command content.", 409);
    if (created) await this.outbox.enqueue({
      id: randomUUID(), organizationId: input.organizationId, topic: COMMAND_TOPIC, aggregateType: "TaskCommand", aggregateId: command.id,
      payloadJson: { commandId: command.id }, availableAt: now, attempts: 0, status: "pending", leaseOwner: null,
      leaseUntil: null, lastError: null, createdAt: now, processedAt: null,
    });
    return command;
  }
}
