import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabaseOrm } from "./orm";
import type { DatabaseConfig } from "./config";
import { createPersistenceRepositories } from "./repositories";
import { DatabaseAgentRegistry } from "./agent-registry";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { acceptCommand, createCommandDispatcher } from "../../runtime/commands";
import { TaskCommandService, COMMAND_TOPIC } from "../../application/services/task-command";
import { SafeDispatchRetry } from "../../application/ports/command-dispatch";
import type { A2ACommandGateway } from "../../application/ports/command-dispatch";
import { OutboxMessageEntity, TaskCommandEntity, TaskEventEntity, TaskEntity } from "./entities";

async function contract(config: DatabaseConfig, directory: string) {
  let orm = await createDatabaseOrm(config);
  const store = new FilesystemArtifactStore(join(directory, "objects"));
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const registry = new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    const agent = await registry.add("https://commands.example.test/card");
    const input = { text: "Durable send", messageId: "stable-input", parts: [{ raw: "aGVsbG8=", mediaType: "text/plain" }] };
    const command = await acceptCommand(agent.id, input, "one", { orm, store });
    const duplicates = await Promise.all([acceptCommand(agent.id, input, "one", { orm, store }), acceptCommand(agent.id, input, "one", { orm, store })]);
    expect(duplicates.map((item) => item.id)).toEqual([command.id, command.id]);
    expect(await orm.em.fork().count(OutboxMessageEntity, {})).toBe(1);
    expect(await orm.em.fork().count(TaskCommandEntity, {})).toBe(1);
    expect(JSON.stringify(await orm.em.fork().find(TaskCommandEntity, {}))).not.toContain("aGVsbG8=");
    await expect(acceptCommand(agent.id, { text: "Different" }, "one", { orm, store })).rejects.toMatchObject({ status: 409 });
    const org = (await createPersistenceRepositories(orm.em.fork()).organizations.findBySlug("local"))!;
    expect(await createPersistenceRepositories(orm.em.fork()).commands.findById(randomUUID(), command.id)).toBeUndefined();
    // Intent and outbox either both commit or both roll back.
    await expect(orm.em.fork().transactional(async (em) => {
      const ports = createPersistenceRepositories(em);
      ports.outbox.enqueue = async () => { throw new Error("Outbox failure"); };
      return new TaskCommandService(ports.agents, ports.commands, ports.outbox, store).accept({ organizationId: org.id,
        agentId: agent.id, tenant: "", action: "send", idempotencyKey: "rollback", params: { text: "Rollback" } });
    })).rejects.toThrow("Outbox failure");
    expect(await orm.em.fork().count(TaskCommandEntity, {})).toBe(1);
    // Pending command survives a complete database-owner restart.
    await orm.close(true); orm = await createDatabaseOrm(config);
    const deliveries: string[] = [];
    const gateway: A2ACommandGateway = { dispatch: async (_agent, cmd, params) => {
      deliveries.push(cmd.messageId);
      expect(params.parts).toEqual(input.parts);
      return { task: { id: "remote-command", status: { state: "TASK_STATE_COMPLETED" } } };
    } };
    const one = createCommandDispatcher({ orm, store, gateway, owner: "worker-one" });
    const two = createCommandDispatcher({ orm, store, gateway, owner: "worker-two" });
    const jobs = await Promise.all([one.runOne(), two.runOne()]);
    expect(jobs.filter(Boolean)).toHaveLength(1);
    expect(deliveries).toEqual(["stable-input"]);
    const success = (await createPersistenceRepositories(orm.em.fork()).commands.findById(org.id, command.id))!;
    expect(success.status).toBe("succeeded");
    expect(success.resultJson).toMatchObject({ event: { task: { id: "remote-command" } } });
    expect(await orm.em.fork().count(TaskEventEntity, {})).toBe(2);
    expect((await orm.em.fork().findOneOrFail(OutboxMessageEntity, { aggregateId: command.id })).status).toBe("processed");
    // A remote failure may have accepted the send. Never silently resend it.
    const uncertain = await acceptCommand(agent.id, { text: "Uncertain" }, "uncertain", { orm, store });
    let attempts = 0;
    const failing = createCommandDispatcher({ orm, store, gateway: { dispatch: async () => { attempts++; throw new Error("Secret upstream detail"); } } });
    await failing.runOne(); await failing.runOne();
    expect(attempts).toBe(1);
    expect(await createPersistenceRepositories(orm.em.fork()).commands.findById(org.id, uncertain.id)).toMatchObject({ status: "uncertain" });
    expect(JSON.stringify(await orm.em.fork().find(TaskCommandEntity, {}))).not.toContain("Secret upstream detail");
    // Expired lease recovery is fenced; even a restarted worker does not send again.
    const interrupted = await acceptCommand(agent.id, { text: "Interrupted" }, "interrupted", { orm, store });
    const past = new Date(Date.now() - 120_000);
    const leased = await orm.em.fork().transactional((em) => createPersistenceRepositories(em).outbox.claim(COMMAND_TOPIC, "old-worker", new Date(), new Date(Date.now() + 1000)));
    await orm.em.fork().nativeUpdate(OutboxMessageEntity, { id: leased!.message.id }, { leaseUntil: past });
    expect(await createPersistenceRepositories(orm.em.fork()).outbox.finish(leased!.message.id, org.id, "old-worker", new Date(), {
      status: "processed", availableAt: new Date(), processedAt: new Date(), lastError: null,
    })).toBe(false);
    await failing.runOne();
    expect(attempts).toBe(1);
    expect(await createPersistenceRepositories(orm.em.fork()).commands.findById(org.id, interrupted.id)).toMatchObject({ status: "uncertain" });
    // Pre-dispatch discovery failures retry with stable message IDs and a bound.
    const retry = await acceptCommand(agent.id, { text: "Retry" }, "retry", { orm, store });
    const retryIds: string[] = [];
    const safe = createCommandDispatcher({ orm, store, gateway: { dispatch: async (_agent, cmd) => { retryIds.push(cmd.messageId); throw new SafeDispatchRetry("Before network dispatch"); } } });
    for (let count = 0; count < 3; count++) {
      await orm.em.fork().nativeUpdate(OutboxMessageEntity, { aggregateId: retry.id }, { availableAt: new Date(0) });
      await safe.runOne();
    }
    expect(retryIds).toEqual([retry.messageId, retry.messageId, retry.messageId]);
    expect(await createPersistenceRepositories(orm.em.fork()).commands.findById(org.id, retry.id)).toMatchObject({ status: "failed" });
    // Losing a lease during response ingestion rolls back its event/projection.
    const fenced = await acceptCommand(agent.id, { text: "Fenced" }, "fenced", { orm, store });
    const fenceWorker = createCommandDispatcher({ orm, store, gateway: { dispatch: async () => {
      await orm.em.fork().nativeUpdate(OutboxMessageEntity, { aggregateId: fenced.id }, { leaseUntil: past });
      return { task: { id: "must-rollback", status: { state: "TASK_STATE_COMPLETED" } } };
    } } });
    await fenceWorker.runOne();
    expect(await orm.em.fork().count(TaskEntity, { remoteTaskId: "must-rollback" })).toBe(0);
    expect(await orm.em.fork().count(TaskEventEntity, {})).toBe(2);
    await failing.runOne();
    expect(await createPersistenceRepositories(orm.em.fork()).commands.findById(org.id, fenced.id)).toMatchObject({ status: "uncertain" });
    // The same key can belong to another organization; foreign agents cannot.
    const other = await createPersistenceRepositories(orm.em.fork()).organizations.getOrCreate({ id: randomUUID(), slug: "other",
      name: "Other", createdAt: new Date(), updatedAt: new Date() });
    const otherAgent = await createPersistenceRepositories(orm.em.fork()).agents.insert({ id: randomUUID(), organizationId: other.id,
      cardUrl: "https://other.example.test/card", source: "managed", enabled: true, displayName: null, description: null,
      protocolSnapshotVersion: null, lastDiscoveryAt: null, lastHealthyAt: null, createdAt: new Date(), updatedAt: new Date() });
    const acceptOther = (agentId: string) => orm.em.fork().transactional((em) => {
      const ports = createPersistenceRepositories(em);
      return new TaskCommandService(ports.agents, ports.commands, ports.outbox, store).accept({ organizationId: other.id,
        agentId, tenant: "", action: "send", idempotencyKey: "one", params: { text: "Other" } });
    });
    await expect(acceptOther(agent.id)).rejects.toMatchObject({ status: 404 });
    const otherCommand = await acceptOther(otherAgent.id);
    expect(otherCommand.id).not.toBe(command.id);
    await createCommandDispatcher({ orm, store, gateway: { dispatch: async () => ({ message: {
      messageId: "other-direct", role: "ROLE_AGENT", parts: [{ text: "Other answer" }],
    } }) } }).runOne();
    const otherResult = (await createPersistenceRepositories(orm.em.fork()).commands.findById(other.id, otherCommand.id))!;
    expect(otherResult.status).toBe("succeeded");
    expect(await createPersistenceRepositories(orm.em.fork()).commands.findById(org.id, otherCommand.id)).toBeUndefined();
    const otherLocalId = (otherResult.resultJson as { localId: string }).localId;
    expect(await createPersistenceRepositories(orm.em.fork()).tasks.findById(org.id, otherLocalId)).toBeUndefined();
    expect(await createPersistenceRepositories(orm.em.fork()).tasks.findById(other.id, otherLocalId)).toMatchObject({ kind: "message", remoteTaskId: null });
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally { await orm.close(true); }
}
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-commands-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("TSK-007 REL-001 PGlite commands", () => {
  it("persists intent, fences dispatch, recovers restart and prevents uncertain retries", async () => {
    await temporary((directory) => contract({ profile: "pglite", dataDir: join(directory, "db") }, directory));
  });
});
const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
if (process.env.CI === "true" && !postgresUrl) throw new Error("CI must set A2A_TEST_POSTGRES_URL");
if (postgresUrl && !decodeURIComponent(new URL(postgresUrl).pathname).includes("test")) throw new Error("A2A_TEST_POSTGRES_URL must target a test database");
(postgresUrl ? describe : describe.skip)("TST-001 PostgreSQL commands", () => {
  it("passes the same command and lease contract", async () => {
    await temporary((directory) => contract({ profile: "postgresql", url: postgresUrl! }, directory));
  });
});
