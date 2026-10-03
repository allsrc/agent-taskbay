import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseConfig } from "./config";
import type { A2APushGateway } from "../../application/ports/push";
import { PushUnsupported } from "../../application/ports/push";
import type { JsonValue, PushRegistrationRecord } from "../../domain/persistence-model";
import { createDatabaseOrm } from "./orm";
import { createPersistenceRepositories } from "./repositories";
import { MikroOrmPushRepository } from "./push-repository";
import { DatabaseAgentRegistry } from "./agent-registry";
import { PushRegistrationEntity, TaskEntity, TaskEventEntity } from "./entities";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { createTaskObserver } from "../../runtime/task-persistence";
import { createPushWorker, receivePush } from "../../runtime/push";
import { loadPushCredentials } from "../../runtime/push-config";

const snapshot = (id: string, state = "TASK_STATE_WORKING"): JsonValue => ({ task: { id, contextId: "context", status: { state } } });
const credentials = loadPushCredentials({ A2A_PUSH_CALLBACK_ORIGIN: "https://console.example.test", A2A_PUSH_SIGNING_KEY: "ab".repeat(32) })!;
async function contract(config: DatabaseConfig, directory: string) {
  let orm = await createDatabaseOrm(config);
  const store = new FilesystemArtifactStore(join(directory, "objects"));
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const registry = new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    const agent = await registry.add("https://push.example.test/card");
    const org = (await createPersistenceRepositories(orm.em.fork()).organizations.findBySlug("local"))!;
    const ports = () => createPersistenceRepositories(orm.em.fork());
    const observe = (event: JsonValue, tenant = "", enabled = true, agentId = agent.id, organizationId = org.id) =>
      createTaskObserver({ organizationId, agentId, tenant, sessionId: randomUUID(), requestId: randomUUID() }, { orm, store, managePush: enabled })(event);
    const firstTask = await observe(snapshot("shared"));
    let registration = (await ports().push.findByTaskId(org.id, firstTask.localId))!;
    expect(registration).toMatchObject({ status: "pending", desired: true });
    await expect(createTaskObserver({ agentId: agent.id, sessionId: randomUUID(), requestId: randomUUID() }, {
      orm, store, managePush: true, onObserved: async () => { throw new Error("Rollback"); },
    })(snapshot("rollback"))).rejects.toThrow("Rollback");
    expect(await orm.em.fork().count(TaskEntity, { remoteTaskId: "rollback" })).toBe(0);
    expect(await orm.em.fork().count(PushRegistrationEntity, {})).toBe(1);
    await observe({ message: { messageId: "direct", role: "ROLE_AGENT", parts: [{ text: "No fake task" }] } });
    expect(await orm.em.fork().count(PushRegistrationEntity, {})).toBe(1);
    let release!: () => void;
    let opened!: () => void;
    const entered = new Promise<void>((resolve) => { opened = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const calls: { id: string; token: string }[] = [];
    const removed: string[] = [];
    const gateway: A2APushGateway = {
      register: async (_agent, task, id, url, token) => {
        expect(task.remoteTaskId).toBe("shared"); expect(url).toBe(credentials.callbackUrl(registration));
        calls.push({ id, token }); opened(); await hold;
      }, remove: async (_agent, _task, id) => { removed.push(id); },
    };
    const worker = () => createPushWorker({ orm, store, credentials, gateway });
    const shutdown = new AbortController();
    const running = worker().runOne("first", shutdown.signal);
    await Promise.race([entered, running.then(() => { throw new Error("Worker ended before opening gateway"); })]);
    expect(await worker().runOne("second", shutdown.signal)).toBe(false);
    release(); await running;
    registration = (await ports().push.findByTaskId(org.id, firstTask.localId))!;
    expect(registration).toMatchObject({ status: "active", leaseOwner: null });
    expect(calls).toHaveLength(1);
    const send = (reg: PushRegistrationRecord, event: unknown, headers: Record<string, string> = {}) => receivePush(reg.id,
      new Request(credentials.callbackUrl(reg), { method: "POST", headers: { "Content-Type": "application/a2a+json",
        Authorization: `Bearer ${credentials.token(reg)}`, ...headers }, body: JSON.stringify(event) }), { orm, store, credentials });
    // Authenticate before parsing; neither malformed nor malicious bodies reach ingestion.
    await expect(send(registration, "not an event", { Authorization: "Bearer invalid" })).rejects.toMatchObject({ status: 401 });
    await expect(send(registration, snapshot("foreign"))).rejects.toMatchObject({ status: 409 });
    await expect(send(registration, { statusUpdate: { taskId: "shared", tenant: "other", status: { state: "TASK_STATE_WORKING" } } })).rejects.toMatchObject({ status: 409 });
    await expect(send(registration, { task: {}, message: {} })).rejects.toMatchObject({ status: 400 });
    await expect(send(registration, snapshot("shared"), { "Content-Type": "text/plain" })).rejects.toMatchObject({ status: 415 });
    await expect(send(registration, snapshot("shared"), { "Content-Length": String(17 * 1024 * 1024) })).rejects.toMatchObject({ status: 400 });
    expect(await orm.em.fork().count(TaskEntity, { remoteTaskId: "foreign" })).toBe(0);
    // A failure after projection/event writes rolls back the whole callback.
    const beforeRollback = (await ports().tasks.findById(org.id, firstTask.localId))!;
    const syncFailure = vi.spyOn(MikroOrmPushRepository.prototype, "sync").mockRejectedValueOnce(new Error("Injected push rollback"));
    const rollbackEvent = { statusUpdate: { taskId: "shared", status: { state: "TASK_STATE_WORKING", timestamp: "2026-10-03T01:00:00Z" } } };
    try { await expect(send(registration, rollbackEvent)).rejects.toThrow("Injected push rollback"); }
    finally { syncFailure.mockRestore(); }
    expect((await ports().tasks.findById(org.id, firstTask.localId))!.version).toBe(beforeRollback.version);
    expect(await orm.em.fork().count(TaskEventEntity, { taskId: firstTask.localId, source: "webhook" })).toBe(0);
    await send(registration, rollbackEvent);
    const chunk = { artifactUpdate: { taskId: "shared", artifact: { artifactId: "text", parts: [{ text: "A" }] }, append: true } };
    await Promise.all([send(registration, chunk, { "X-A2A-Delivery-ID": "chunk-1" }), send(registration, chunk, { "X-A2A-Delivery-ID": "chunk-1" })]);
    await send(registration, chunk, { "X-A2A-Delivery-ID": "chunk-2" });
    const file = { artifactUpdate: { taskId: "shared", artifact: { artifactId: "file", parts: [{ raw: "aGVsbG8=", mediaType: "text/plain" }] }, lastChunk: true } };
    await send(registration, file); await send(registration, file);
    const prompt = { statusUpdate: { taskId: "shared", status: { state: "TASK_STATE_INPUT_REQUIRED",
      timestamp: "2026-10-03T01:00:01Z", message: { messageId: "question", role: "ROLE_AGENT", parts: [{ text: "Proceed?" }] } } } };
    await send(registration, prompt); await send(registration, prompt);
    let stored = (await ports().tasks.findById(org.id, firstTask.localId))!;
    expect(stored).toMatchObject({ state: "TASK_STATE_INPUT_REQUIRED", contentJson: {
      artifacts: [{ parts: [{ value: "AA" }] }, { parts: [{ value: expect.stringMatching(/^\/api\/artifacts\//) }] }], messages: [{ id: "question" }],
    } });
    expect(await ports().push.findByTaskId(org.id, firstTask.localId)).toMatchObject({ status: "active", desired: true });
    expect(await orm.em.fork().count(TaskEventEntity, { taskId: firstTask.localId, source: "webhook" })).toBe(5);
    // Tenant, agent and organization collisions each retain independent registrations.
    const tenantTask = await observe(snapshot("shared"), "tenant-b");
    const otherAgent = await registry.add("https://other-push.example.test/card");
    const agentTask = await observe(snapshot("shared"), "", true, otherAgent.id);
    const foreignOrg = await ports().organizations.getOrCreate({ ...org, id: randomUUID(), slug: "foreign" });
    const foreignAgent = await ports().agents.insert({ ...(await ports().agents.findById(org.id, agent.id))!, id: randomUUID(), organizationId: foreignOrg.id });
    const foreignTask = await observe(snapshot("shared"), "", true, foreignAgent.id, foreignOrg.id);
    for (const [organizationId, localId] of [[org.id, tenantTask.localId], [org.id, agentTask.localId], [foreignOrg.id, foreignTask.localId]]) {
      const scoped = (await ports().push.findByTaskId(organizationId, localId))!;
      await expect(send(scoped, prompt, { Authorization: `Bearer ${credentials.token(registration)}` })).rejects.toMatchObject({ status: 401 });
      expect((await ports().tasks.findById(organizationId, localId))!.state).toBe("TASK_STATE_WORKING");
    }
    expect(await ports().push.findByTaskId(foreignOrg.id, firstTask.localId)).toBeUndefined();
    // Disable unrelated pending registrations for subsequent lifecycle checks.
    await orm.em.fork().nativeUpdate(PushRegistrationEntity, { taskId: { $in: [tenantTask.localId, agentTask.localId, foreignTask.localId] } }, { status: "failed" });
    // Replay and durable rate windows survive full database-owner restart.
    await orm.em.fork().nativeUpdate(PushRegistrationEntity, { id: registration.id }, { rateCount: 119, rateWindow: new Date() });
    await orm.close(true); orm = await createDatabaseOrm(config);
    expect(credentials.token((await ports().push.findById(registration.id))!)).toBe(calls[0].token);
    await send(registration, prompt);
    await expect(send(registration, prompt)).rejects.toMatchObject({ status: 429 });
    await orm.em.fork().nativeUpdate(PushRegistrationEntity, { id: registration.id }, { rateWindow: new Date(0) });
    await send(registration, prompt);
    // A terminal callback commits cleanup intent; late/stale updates cannot reopen it.
    await send(registration, { kind: "task", id: "shared", contextId: "context", status: { state: "completed", timestamp: "2026-10-03T01:00:02Z" } });
    expect(await ports().push.findById(registration.id)).toMatchObject({ status: "deleting", desired: false });
    await send(registration, prompt);
    expect((await ports().tasks.findById(org.id, firstTask.localId))!.state).toBe("TASK_STATE_COMPLETED");
    await worker().runOne("cleanup", shutdown.signal);
    expect(removed).toEqual([registration.id]);
    expect(await ports().push.findById(registration.id)).toMatchObject({ status: "deleted", leaseOwner: null });
    await expect(send(registration, prompt)).rejects.toMatchObject({ status: 401 });
    // Existing tasks are adopted only by explicitly configured workers.
    const existing = await observe(snapshot("adopted"), "", false);
    expect(await ports().push.findByTaskId(org.id, existing.localId)).toBeUndefined();
    await worker().adopt(); await worker().adopt();
    const adopted = (await ports().push.findByTaskId(org.id, existing.localId))!;
    const crash = await orm.em.fork().transactional((em) => createPersistenceRepositories(em).push.claim("crashed", new Date(), new Date(Date.now() + 15_000)));
    expect(crash!.id).toBe(adopted.id);
    await orm.em.fork().nativeUpdate(PushRegistrationEntity, { id: adopted.id }, { leaseUntil: new Date(0) });
    await orm.close(true); orm = await createDatabaseOrm(config);
    expect(await orm.em.fork().transactional((em) => createPersistenceRepositories(em).push.finish(crash!, new Date(),
      { status: "active", availableAt: new Date(), lastError: null }))).toBe(false);
    let recoveredId: string | undefined;
    await createPushWorker({ orm, store, credentials, gateway: {
      register: async (_agent, _task, id, _url, token) => { recoveredId = id; expect(token).toBe(credentials.token(adopted)); }, remove: gateway.remove,
    } }).runOne("recovered", shutdown.signal);
    expect(recoveredId).toBe(adopted.id);
    // Agent disablement rejects callbacks and schedules remote deletion without a task event.
    await ports().agents.updateRegistration(org.id, agent.id, { enabled: false, source: "managed", updatedAt: new Date() });
    await expect(send(adopted, snapshot("adopted"))).rejects.toMatchObject({ status: 401 });
    for (let attempt = 0; attempt < 4 && await worker().runOne(`disabled-${attempt}`, shutdown.signal); attempt++) { /* Drain all registrations for this disabled agent. */ }
    expect(await ports().push.findById(adopted.id)).toMatchObject({ status: "deleted", desired: false });
    await orm.em.fork().nativeUpdate(PushRegistrationEntity, { taskId: tenantTask.localId }, { status: "deleted", desired: false });
    await ports().agents.updateRegistration(org.id, agent.id, { enabled: true, source: "managed", updatedAt: new Date() });
    const inFlightTask = await observe(snapshot("terminal-during-create"));
    const inFlight = (await ports().push.findByTaskId(org.id, inFlightTask.localId))!;
    await createPushWorker({ orm, store, credentials, gateway: {
      register: async () => { await observe(snapshot("terminal-during-create", "TASK_STATE_CANCELED")); }, remove: gateway.remove,
    } }).runOne("cancel-during-create", shutdown.signal);
    expect(await ports().push.findById(inFlight.id)).toMatchObject({ status: "deleting", desired: false, leaseOwner: null });
    await worker().runOne("clean-canceled", shutdown.signal);
    expect(await ports().push.findById(inFlight.id)).toMatchObject({ status: "deleted" });
    // Transient failures redact remote errors and retry, unsupported peers stop.
    const failedTask = await observe(snapshot("retry"));
    const failed = (await ports().push.findByTaskId(org.id, failedTask.localId))!;
    await createPushWorker({ orm, store, credentials, gateway: { register: async () => { throw new Error("Authorization: Bearer secret"); }, remove: gateway.remove } }).runOne("retry", shutdown.signal);
    expect(await ports().push.findById(failed.id)).toMatchObject({ status: "pending", lastError: "Push configuration unavailable; retry scheduled." });
    await orm.em.fork().nativeUpdate(PushRegistrationEntity, { id: failed.id }, { availableAt: new Date(0) });
    await createPushWorker({ orm, store, credentials, gateway: { register: async () => { throw new PushUnsupported(); }, remove: gateway.remove } }).runOne("unsupported", shutdown.signal);
    expect(await ports().push.findById(failed.id)).toMatchObject({ status: "failed", lastError: "Agent does not support task push notifications." });
    stored = (await ports().tasks.findById(org.id, firstTask.localId))!;
    const serialized = JSON.stringify([stored, await ports().push.findById(registration.id), await ports().taskEvents.findByTaskId(org.id, firstTask.localId)]);
    expect(serialized).not.toContain(calls[0].token); expect(serialized).not.toContain("aGVsbG8=");
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally { await orm.close(true); }
}
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-push-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("TSK-003 REL-001 SEC-003 authenticated push on PGlite", () => {
  it("registers, authenticates, deduplicates, isolates scope and recovers lifecycle across restart", async () => {
    await temporary((directory) => contract({ profile: "pglite", dataDir: join(directory, "db") }, directory));
  }, 20_000);
});
const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
if (process.env.CI === "true" && !postgresUrl) throw new Error("CI must set A2A_TEST_POSTGRES_URL");
if (postgresUrl && !decodeURIComponent(new URL(postgresUrl).pathname).includes("test")) throw new Error("A2A_TEST_POSTGRES_URL must target a test database");
(postgresUrl ? describe : describe.skip)("TST-001 PostgreSQL authenticated push", () => {
  it("passes the same authenticated push and lifecycle contract", async () => {
    await temporary((directory) => contract({ profile: "postgresql", url: postgresUrl! }, directory));
  }, 20_000);
});
