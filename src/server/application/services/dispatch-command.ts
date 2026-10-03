import type { Clock } from "../ports/clock";
import type { ArtifactStore } from "../ports/artifact-store";
import type { CommandUnitOfWork, A2ACommandGateway, CommandResponseSink } from "../ports/command-dispatch";
import { SafeDispatchRetry, PermanentDispatchFailure } from "../ports/command-dispatch";
import type { JsonValue, OutboxMessageRecord, CommandStatus } from "../../domain/persistence-model";
import { COMMAND_TOPIC } from "./task-command";
import { object } from "./task-projection";

export const COMMAND_LEASE_MS = 60_000;
export class CommandDispatcher {
  constructor(private readonly work: CommandUnitOfWork, private readonly gateway: A2ACommandGateway,
    private readonly store: ArtifactStore, private readonly sink: CommandResponseSink,
    private readonly owner: string, private readonly clock: Clock = { now: () => new Date() }) {}

  async runOne(): Promise<boolean> {
    const now = this.clock.now();
    const claim = await this.work.run((ports) => ports.outbox.claim(COMMAND_TOPIC, this.owner, now, new Date(now.getTime() + COMMAND_LEASE_MS)));
    if (!claim) return false;
    const message = claim.message;
    const command = await this.work.run((ports) => ports.commands.findById(message.organizationId, message.aggregateId));
    if (!command) { await this.settle(message, "failed", "Command intent is missing."); return true; }
    if (claim.recovered) {
      await this.settle(message, "uncertain", "A previous dispatch lease expired. Remote outcome requires reconciliation.");
      return true;
    }
    const heartbeat = setInterval(() => {
      const time = this.clock.now();
      void this.work.run((ports) => ports.outbox.renew(message.id, message.organizationId, this.owner, time,
        new Date(time.getTime() + COMMAND_LEASE_MS))).catch(() => undefined);
    }, COMMAND_LEASE_MS / 3);
    heartbeat.unref?.();
    try {
      const agent = await this.work.run((ports) => ports.agents.findById(command.organizationId, command.agentId));
      if (!agent?.enabled) throw new PermanentDispatchFailure("Agent is disabled.");
      const [organizationId, digest] = command.payloadObjectKey.split("/");
      if (organizationId !== command.organizationId) throw new PermanentDispatchFailure("Invalid input archive scope.");
      const bytes = await this.store.get(organizationId, digest);
      if (!bytes) throw new PermanentDispatchFailure("Input archive is missing.");
      const params = JSON.parse(Buffer.from(bytes).toString()) as Record<string, JsonValue>;
      await this.work.run(async (ports) => {
        const time = this.clock.now();
        if (!await ports.outbox.renew(message.id, message.organizationId, this.owner, time, new Date(time.getTime() + COMMAND_LEASE_MS))) throw new Error("Lease lost.");
        await ports.commands.update(command.organizationId, command.id, { status: "dispatching", resultJson: null, lastError: null, updatedAt: time });
      });
      const event = await this.gateway.dispatch(agent, command, params);
      const userMessage = command.action === "send" ? {
        messageId: command.messageId, role: "ROLE_USER", taskId: params.taskId ?? "", contextId: params.contextId ?? "",
        parts: typeof params.text === "string" && params.text.trim() ? [{ text: params.text }, ...(Array.isArray(params.parts) ? params.parts : [])] : params.parts ?? [],
        referenceTaskIds: params.referenceTaskIds ?? [], metadata: object(params.metadata),
      } as JsonValue : undefined;
      await this.sink.commit(message, command, event, userMessage);
    } catch (error) {
      if (error instanceof SafeDispatchRetry && message.attempts < 3) {
        await this.settle(message, "pending", "Agent discovery failed before dispatch; retry scheduled.", 1000 * 2 ** (message.attempts - 1));
      } else if (error instanceof PermanentDispatchFailure || error instanceof SafeDispatchRetry) {
        await this.settle(message, "failed", error instanceof SafeDispatchRetry ? "Agent discovery failed before dispatch after three attempts." : "Command could not dispatch: unavailable agent or input archive.");
      } else {
        await this.settle(message, "uncertain", "Remote outcome is uncertain. Automatic resend is disabled; check the task before submitting new work.");
      }
    } finally { clearInterval(heartbeat); }
    return true;
  }

  private async settle(message: OutboxMessageRecord, status: CommandStatus, lastError: string, delay = 0) {
    await this.work.run(async (ports) => {
      const now = this.clock.now();
      const finished = await ports.outbox.finish(message.id, message.organizationId, this.owner, now, {
        status: status === "pending" ? "pending" : "failed", availableAt: new Date(now.getTime() + delay), lastError, processedAt: null,
      });
      if (finished) await ports.commands.update(message.organizationId, message.aggregateId, { status, resultJson: null, lastError, updatedAt: now });
    });
  }
}
