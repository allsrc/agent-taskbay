import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DatabaseConfig } from "./config";
import type { A2ASubscriptionGateway } from "../../application/ports/subscriptions";
import { SubscriptionUnsupported } from "../../application/ports/subscriptions";
import type { JsonValue } from "../../domain/persistence-model";
import { createDatabaseOrm } from "./orm";
import { createPersistenceRepositories } from "./repositories";
import { DatabaseAgentRegistry } from "./agent-registry";
import { SubscriptionEntity, TaskEventEntity, TaskEntity } from "./entities";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { createTaskObserver } from "../../runtime/task-persistence";
import { createSubscriptionWorker } from "../../runtime/subscriptions";
import { acceptCommand, createCommandDispatcher } from "../../runtime/commands";

const snapshot = (id: string, state = "TASK_STATE_WORKING"): JsonValue => ({ task: { id, status: { state } } });
const session = (events: JsonValue[]) => ({ events: (async function* () { yield* events; })(),
  metadata: { protocolVersion: "1.0", transport: "JSONRPC", negotiatedExtensions: ["https://example.test/events"] } });

async function contract(config: DatabaseConfig, directory: string) {
  let orm = await createDatabaseOrm(config);
  const store = new FilesystemArtifactStore(join(directory, "objects"));
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const registry = new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    const agent = await registry.add("https://subscription.example.test/card");
    const org = (await createPersistenceRepositories(orm.em.fork()).organizations.findBySlug("local"))!;
    const ports = () => createPersistenceRepositories(orm.em.fork());
    const observe = (remoteId: string, tenant = "") => createTaskObserver({ organizationId: org.id, agentId: agent.id,
      tenant, sessionId: randomUUID(), requestId: randomUUID() }, { orm, store })(snapshot(remoteId));
    // Command response, projection and subscription intent commit atomically.
    const command = await acceptCommand(agent.id, { text: "Start durable observation" }, "observe", { orm, store });
    await createCommandDispatcher({ orm, store, gateway: { dispatch: async () => snapshot("shared") } }).runOne();
    const result = (await ports().commands.findById(org.id, command.id))!.resultJson as { localId: string };
    const localId = result.localId;
    expect(await ports().subscriptions.findByTaskId(org.id, localId)).toMatchObject({ status: "pending", attempts: 0 });
    await expect(createTaskObserver({ agentId: agent.id, sessionId: randomUUID(), requestId: randomUUID() }, {
      orm, store, onObserved: async () => { throw new Error("Rollback"); },
    })(snapshot("rollback"))).rejects.toThrow("Rollback");
    expect(await orm.em.fork().count(TaskEntity, { remoteTaskId: "rollback" })).toBe(0);
    expect(await orm.em.fork().count(SubscriptionEntity, {})).toBe(1);
    // Two workers race for a pending intent; one owns the remote stream.
    let release!: () => void;
    let opened!: () => void;
    const entered = new Promise<void>((resolve) => { opened = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const append: JsonValue = { artifactUpdate: { taskId: "shared", artifact: { artifactId: "text", parts: [{ text: "A" }] }, append: true } };
    const file: JsonValue = { artifactUpdate: { taskId: "shared", artifact: { artifactId: "file", parts: [{ raw: "aGVsbG8=", mediaType: "text/plain" }] }, lastChunk: true } };
    let subscriptions = 0;
    const gateway: A2ASubscriptionGateway = { subscribe: async () => {
      subscriptions++; opened(); await hold;
      return session([append, append, file]);
    } };
    const worker = () => createSubscriptionWorker({ orm, store, gateway });
    const shutdown = new AbortController();
    const first = worker().runOne("first", shutdown.signal);
    await entered;
    expect(await worker().runOne("second", shutdown.signal)).toBe(false);
    release(); await first;
    expect(subscriptions).toBe(1);
    expect(await ports().subscriptions.findByTaskId(org.id, localId)).toMatchObject({ status: "pending", attempts: 1 });
    const before = (await ports().tasks.findById(org.id, localId))!.contentJson;
    expect(before).toMatchObject({ artifacts: [{ parts: [{ value: "AA" }] }, { parts: [{ value: expect.stringMatching(/^\/api\/artifacts\//) }] }] });
    // A worker crash releases only through expiry; safe resubscription replays
    // the same chunks without duplicating content after database owner restart.
    await orm.em.fork().nativeUpdate(SubscriptionEntity, { taskId: localId }, { availableAt: new Date(0) });
    const crashLease = await orm.em.fork().transactional((em) => createPersistenceRepositories(em).subscriptions.claim("crashed", new Date(), new Date(Date.now() + 15_000)));
    await orm.em.fork().nativeUpdate(SubscriptionEntity, { taskId: localId }, { leaseUntil: new Date(0) });
    await orm.close(true); orm = await createDatabaseOrm(config);
    expect(await ports().subscriptions.renew(crashLease!, new Date(), new Date(Date.now() + 15_000))).toBe(false);
    const prompt: JsonValue = { statusUpdate: { taskId: "shared", status: { state: "TASK_STATE_INPUT_REQUIRED",
      message: { messageId: "prompt", role: "ROLE_AGENT", parts: [{ text: "Proceed?" }] } }, final: true } };
    await createSubscriptionWorker({ orm, store, gateway: { subscribe: async () => session([append, append, file, prompt]) } }).runOne("restarted", shutdown.signal);
    const paused = (await ports().tasks.findById(org.id, localId))!;
    expect(paused.state).toBe("TASK_STATE_INPUT_REQUIRED");
    expect(paused.contentJson).toMatchObject({ artifacts: (before as { artifacts: JsonValue }).artifacts,
      messages: [expect.objectContaining({ role: "user" }), expect.objectContaining({ id: "prompt" })] });
    expect(await ports().subscriptions.findByTaskId(org.id, localId)).toMatchObject({ status: "stopped", attempts: 3 });
    // The safe committed event feed is bounded, indexed and organization scoped.
    const feed = await ports().taskEvents.readFeed(org.id, localId, 0, 2);
    expect(feed).toHaveLength(2);
    const next = await ports().taskEvents.readFeed(org.id, localId, feed[1].sequence!, 100);
    expect(next.length).toBeGreaterThan(0);
    expect(new Set([...feed, ...next].map((event) => event.sequence)).size).toBe(feed.length + next.length);
    expect(await ports().taskEvents.readFeed(randomUUID(), localId, 0, 100)).toEqual([]);
    expect(JSON.stringify(next)).not.toContain("aGVsbG8=");
    expect(next.some((event) => (event.payloadJson as { streamMetadata?: unknown }).streamMetadata)).toBe(true);
    // A reply re-arms observation in the command completion transaction.
    const reply = await acceptCommand(agent.id, { text: "Proceed", taskId: "shared" }, "reply", { orm, store });
    await createCommandDispatcher({ orm, store, gateway: { dispatch: async () => snapshot("shared") } }).runOne();
    expect((await ports().commands.findById(org.id, reply.id))!.status).toBe("succeeded");
    expect(await ports().subscriptions.findByTaskId(org.id, localId)).toMatchObject({ status: "pending", attempts: 0 });
    // A cancel observed while a stream is live revokes its ability to commit.
    // Repeating the same untimestamped prompt in a new turn pauses again.
    await createSubscriptionWorker({ orm, store, gateway: { subscribe: async () => session([prompt, prompt]) } }).runOne("re-prompt", shutdown.signal);
    expect((await ports().tasks.findById(org.id, localId))!.state).toBe("TASK_STATE_INPUT_REQUIRED");
    expect(((await ports().tasks.findById(org.id, localId))!.contentJson as { messages: { id: string }[] }).messages.filter((item) => item.id === "prompt")).toHaveLength(1);
    await acceptCommand(agent.id, { text: "Proceed again", taskId: "shared" }, "reply-again", { orm, store });
    await createCommandDispatcher({ orm, store, gateway: { dispatch: async () => snapshot("shared") } }).runOne();
    const lateWorker = createSubscriptionWorker({ orm, store, gateway: { subscribe: async () => {
      await createTaskObserver({ agentId: agent.id, sessionId: randomUUID(), requestId: randomUUID(), source: "command_response" }, { orm, store })(snapshot("shared", "TASK_STATE_CANCELED"));
      return session([{ artifactUpdate: { taskId: "shared", artifact: { artifactId: "late", parts: [{ text: "Must roll back" }] } } }]);
    } } });
    await lateWorker.runOne("late", shutdown.signal);
    expect((await ports().tasks.findById(org.id, localId))!.state).toBe("TASK_STATE_CANCELED");
    expect(JSON.stringify((await ports().tasks.findById(org.id, localId))!.contentJson)).not.toContain("Must roll back");
    // Cross-task stream IDs fail before creating a projection in either scope.
    const scoped = await observe("shared", "other-tenant");
    await createSubscriptionWorker({ orm, store, gateway: { subscribe: async (_agent, task) => {
      expect(task.tenant).toBe("other-tenant");
      return session([snapshot("foreign-task")]);
    } } }).runOne("scope", shutdown.signal);
    expect(await orm.em.fork().count(TaskEntity, { remoteTaskId: "foreign-task" })).toBe(0);
    expect(await ports().subscriptions.findByTaskId(org.id, scoped.localId)).toMatchObject({ status: "pending", lastError: "Task stream unavailable; reconnect scheduled." });
    await orm.em.fork().nativeUpdate(SubscriptionEntity, { taskId: scoped.localId }, { availableAt: new Date(0) });
    await createSubscriptionWorker({ orm, store, gateway: { subscribe: async () => { throw new SubscriptionUnsupported(); } } }).runOne("unsupported", shutdown.signal);
    expect(await ports().subscriptions.findByTaskId(org.id, scoped.localId)).toMatchObject({ status: "stopped", lastError: "Agent does not support task streaming." });
    // Graceful shutdown aborts a quiet stream and releases intent immediately.
    const quiet = await observe("quiet");
    const abort = new AbortController();
    const quietWorker = createSubscriptionWorker({ orm, store, gateway: { subscribe: async (_agent, _task, signal) => {
      queueMicrotask(() => abort.abort());
      return { events: (async function* () {
        if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      })() };
    } } });
    await quietWorker.runOne("shutdown", abort.signal);
    expect(await ports().subscriptions.findByTaskId(org.id, quiet.localId)).toMatchObject({ status: "pending", leaseOwner: null, lastError: null });
    expect(await orm.em.fork().count(TaskEventEntity, { taskId: quiet.localId })).toBe(1);
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally { await orm.close(true); }
}

async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-subscriptions-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("TSK-003 HITL-001 REL-001 worker subscriptions on PGlite", () => {
  it("leases, reconnects across restart, replays content, pauses and fences ingestion", async () => {
    await temporary((directory) => contract({ profile: "pglite", dataDir: join(directory, "db") }, directory));
  });
});
const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
if (process.env.CI === "true" && !postgresUrl) throw new Error("CI must set A2A_TEST_POSTGRES_URL");
if (postgresUrl && !decodeURIComponent(new URL(postgresUrl).pathname).includes("test")) throw new Error("A2A_TEST_POSTGRES_URL must target a test database");
(postgresUrl ? describe : describe.skip)("TST-001 PostgreSQL worker subscriptions", () => {
  it("passes the same worker subscription contract", async () => {
    await temporary((directory) => contract({ profile: "postgresql", url: postgresUrl! }, directory));
  });
});
