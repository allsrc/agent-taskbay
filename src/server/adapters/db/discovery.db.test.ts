import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabaseOrm } from "./orm";
import type { DatabaseConfig } from "./config";
import { createPersistenceRepositories } from "./repositories";
import { DatabaseAgentRegistry } from "./agent-registry";
import { provisionIdentity } from "./identity-repository";
import { createGrant } from "./security-repository";
import { withPrincipal } from "../auth/principal-context";
import { withTaskQueries } from "../../runtime/task-persistence";
import { browseRemoteTasks, trackRemoteTask } from "../../runtime/discovery";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { OutboxMessageEntity, SecurityAuditEntity, SubscriptionEntity, SyncCursorEntity, TaskEntity, TaskEventEntity, TaskCommandEntity, RateBucketEntity } from "./entities";
import { NOTIFICATION_TOPIC } from "../../application/ports/notifications";
import { ListTasksUnsupported } from "../../application/ports/reconciliation";
import { RemoteRejection } from "../../application/ports/remote-errors";
import type { RemoteTaskGateway } from "../../application/ports/remote-tasks";
import type { JsonValue } from "../../domain/persistence-model";

// Browsing lists an agent's tasks without storing anything; tracking stores one, re-read from the agent, and starts following it.
const remote = (id: string, state: string, extra: Record<string, unknown> = {}) => ({ id, contextId: `ctx-${id}`, status: { state, timestamp: new Date().toISOString(),
  message: { messageId: `m-${id}`, role: "ROLE_AGENT", parts: [{ text: `Question about ${id}` }] } }, history: [], artifacts: [], metadata: { tenant: "" }, ...extra });

function fakeGateway(tasks: Map<string, Record<string, unknown>>) {
  const calls = { list: 0, get: 0 };
  const gateway: RemoteTaskGateway & { calls: typeof calls; unsupported: boolean; override?: (id: string) => JsonValue | undefined } = {
    calls, unsupported: false,
    async list(_agent, query) {
      calls.list++;
      if (gateway.unsupported) throw new ListTasksUnsupported();
      const all = [...tasks.values()].filter((task) => !query.status || (task.status as { state: string }).state === query.status);
      const offset = Number(query.pageToken || 0);
      const page = all.slice(offset, offset + query.pageSize);
      return { tasks: page as JsonValue[], nextPageToken: offset + query.pageSize < all.length ? String(offset + query.pageSize) : "" };
    },
    async get(_agent, _tenant, id) {
      calls.get++;
      const overridden = gateway.override?.(id);
      if (overridden) return overridden;
      const task = tasks.get(id);
      if (!task) throw new RemoteRejection("task_not_found", -32001);
      return { task } as JsonValue;
    },
  };
  return gateway;
}

async function contract(config: DatabaseConfig, directory: string) {
  const orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const registry = new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    const agent = await registry.add("https://agent.test/card");
    const org = (await createPersistenceRepositories(orm.em.fork()).organizations.findBySlug("local"))!;
    const person = (subject: string, role: "admin" | "operator" | "viewer") => provisionIdentity(orm.em.fork(), { issuer: "https://idp.test", subject, organizationId: org.id, displayName: subject, role });
    const admin = await person("admin", "admin");
    const whole = await person("whole", "operator");
    const skillScoped = await person("skill", "operator");
    const viewer = await person("viewer", "viewer");
    const nobody = await person("nobody", "operator");
    const grant = (membershipId: string, skillId: string | null) => orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: membershipId, agentId: agent.id, skillId, permission: "operate" }));
    await grant(whole.membershipId, null);
    await grant(skillScoped.membershipId, "public");
    await grant(viewer.membershipId, null);

    const store = new FilesystemArtifactStore(join(directory, "artifacts"));
    const tasks = new Map<string, Record<string, unknown>>([["ask", remote("ask", "TASK_STATE_INPUT_REQUIRED")], ["busy", remote("busy", "TASK_STATE_WORKING")], ["done", remote("done", "TASK_STATE_COMPLETED")]]);
    const gateway = fakeGateway(tasks);
    const options = { orm, gateway, store };
    const browse = (who: typeof admin, query = {}) => withPrincipal(who, () => browseRemoteTasks(agent.id, query, options));
    const track = (who: typeof admin, taskId: string, tenant?: string) => withPrincipal(who, () => trackRemoteTask(agent.id, { taskId, tenant }, options));
    const counts = async () => { const em = orm.em.fork(); return { tasks: await em.count(TaskEntity, {}), events: await em.count(TaskEventEntity, {}), commands: await em.count(TaskCommandEntity, {}),
      subscriptions: await em.count(SubscriptionEntity, {}), cursors: await em.count(SyncCursorEntity, {}), outbox: await em.count(OutboxMessageEntity, {}) }; };

    // Browsing stores nothing at all.
    const empty = await counts();
    const first = await browse(whole);
    expect(first.rows.map((row) => row.taskId).sort()).toEqual(["ask", "busy", "done"]);
    expect(first.rows.find((row) => row.taskId === "ask")).toMatchObject({ state: "TASK_STATE_INPUT_REQUIRED", snippet: "Question about ask", tracked: false, localId: null });
    expect(await counts()).toEqual(empty);
    expect((await browse(whole, { status: "TASK_STATE_WORKING" })).rows.map((row) => row.taskId)).toEqual(["busy"]);
    const page = await browse(whole, { pageSize: 2 });
    expect(page.rows).toHaveLength(2);
    expect((await browse(whole, { pageSize: 2, pageToken: page.nextPageToken })).rows).toHaveLength(1);
    await expect(browse(whole, { status: "nonsense" })).rejects.toMatchObject({ status: 400 });

    // Tracking stores the task as discovered, by this person, and follows it; the browser's content plays no part.
    const tracked = await track(whole, "ask");
    expect(tracked).toMatchObject({ created: true });
    const stored = (await createPersistenceRepositories(orm.em.fork()).tasks.findById(org.id, tracked.localId))!;
    expect(stored).toMatchObject({ origin: "discovered", trackedByUserId: whole.userId, remoteTaskId: "ask", state: "TASK_STATE_INPUT_REQUIRED", skillId: null, ownerUserId: null, tenant: "" });
    expect(stored.discoveredAt).toBeInstanceOf(Date);
    expect(await orm.em.fork().count(SubscriptionEntity, { taskId: stored.id })).toBe(1);
    expect(await orm.em.fork().count(SyncCursorEntity, { taskId: stored.id })).toBe(1);
    // First sight of a tracked task is not news, and the person did not claim it.
    expect(await orm.em.fork().count(OutboxMessageEntity, { topic: NOTIFICATION_TOPIC })).toBe(0);
    // Idempotent: the same task again returns the same row without reading the agent or writing another audit entry.
    const reads = gateway.calls.get;
    expect(await track(whole, "ask")).toEqual({ localId: tracked.localId, created: false });
    expect(gateway.calls.get).toBe(reads);
    expect(await orm.em.fork().count(SecurityAuditEntity, { action: "task.discovery.tracked", targetId: tracked.localId })).toBe(1);
    expect((await browse(whole)).rows.find((row) => row.taskId === "ask")).toMatchObject({ tracked: true, localId: tracked.localId });
    // A finished task can be tracked as read-only history, and is not followed.
    const finished = await track(whole, "done");
    expect((await orm.em.fork().findOneOrFail(SubscriptionEntity, { taskId: finished.localId })).status).toBe("stopped");
    expect((await createPersistenceRepositories(orm.em.fork()).tasks.findById(org.id, finished.localId))!.state).toBe("TASK_STATE_COMPLETED");
    await track(admin, "busy");
    expect(await orm.em.fork().count(TaskEntity, { origin: "discovered" })).toBe(3);

    // Who may browse and track: the whole agent, not a skill, not a viewer, not someone without a grant.
    for (const who of [skillScoped, viewer, nobody]) {
      await expect(browse(who)).rejects.toMatchObject({ status: 403 });
      await expect(track(who, "busy")).rejects.toMatchObject({ status: 403 });
    }
    expect(await browse(admin)).toMatchObject({ rows: expect.any(Array) });
    // Tracked tasks are invisible to a skill-scoped person.
    expect(await withPrincipal(skillScoped, () => withTaskQueries((q, id) => q.detail(id, tracked.localId), orm))).toBeUndefined();
    expect(await withPrincipal(whole, () => withTaskQueries((q, id) => q.detail(id, tracked.localId), orm))).toBeDefined();

    // What the agent says is checked before anything is stored.
    const before = await counts();
    await expect(track(whole, "missing")).rejects.toMatchObject({ status: 404, kind: "task_not_found_on_agent" });
    gateway.override = (id) => id === "swap" ? { task: remote("other", "TASK_STATE_WORKING") } as JsonValue : id === "tenant" ? { task: remote("tenant", "TASK_STATE_WORKING", { metadata: { tenant: "elsewhere" } }) } as JsonValue
      : id === "state" ? { task: { id: "state", status: { state: "TASK_STATE_BOGUS" } } } as JsonValue : undefined;
    for (const id of ["swap", "tenant", "state"]) await expect(track(whole, id), id).rejects.toMatchObject({ status: 502, kind: "agent_response_invalid" });
    gateway.override = undefined;
    expect(await counts()).toEqual(before);
    // A page that is all malformed is an error; a mixed page keeps the good rows.
    tasks.set("broken", { id: "", status: { state: "TASK_STATE_WORKING" } });
    expect((await browse(whole)).dropped).toBe(1);
    for (const key of ["ask", "busy", "done"]) tasks.delete(key);
    await expect(browse(whole)).rejects.toMatchObject({ status: 502, kind: "agent_response_invalid" });
    tasks.delete("broken"); tasks.set("ask", remote("ask", "TASK_STATE_INPUT_REQUIRED"));
    // An agent that cannot list tasks says so; tracking by ID still works when it can answer GetTask.
    gateway.unsupported = true;
    await expect(browse(whole)).rejects.toMatchObject({ status: 501, kind: "listing_unsupported" });
    tasks.set("direct", remote("direct", "TASK_STATE_WORKING"));
    expect(await track(whole, "direct")).toMatchObject({ created: true });
    gateway.unsupported = false;

    // Modes: off refuses, browse allows, and the deployment cap can lower an agent's mode but never raise it.
    const setMode = (taskDiscovery: "off" | "browse" | "auto") => orm.em.fork().transactional((em) => createPersistenceRepositories(em).agents.setTaskDiscovery(org.id, agent.id, { taskDiscovery }, new Date()));
    await setMode("off");
    await expect(browse(whole)).rejects.toMatchObject({ status: 409, kind: "discovery_disabled" });
    await expect(track(whole, "ask")).rejects.toMatchObject({ status: 409, kind: "discovery_disabled" });
    await setMode("auto");
    expect(await browse(whole)).toBeDefined();
    process.env.A2A_TASK_DISCOVERY = "off";
    try { await expect(browse(whole)).rejects.toMatchObject({ status: 409, kind: "discovery_disabled" }); } finally { delete process.env.A2A_TASK_DISCOVERY; }
    await setMode("browse");

    // The rate limit is kept in the database, so every instance shares it.
    const limited = await person("limited", "operator");
    await grant(limited.membershipId, null);
    for (let call = 0; call < 30; call++) await browse(limited);
    await expect(browse(limited)).rejects.toMatchObject({ status: 429 });
    expect(await orm.em.fork().count(RateBucketEntity, { id: { $like: `discovery:browse:${limited.membershipId}:%` } })).toBe(1);
    // Another person is not held back by it.
    expect(await browse(whole)).toBeDefined();
  } finally { await orm.close(true); }
}
async function temporary(config: (directory: string) => DatabaseConfig) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-discovery-"));
  try { await contract(config(directory), directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
afterEach(() => { delete process.env.A2A_TASK_DISCOVERY; });
describe("browse and track (PGlite)", () => {
  it("lists without storing, tracks what a person chooses, and keeps to its rules", () => temporary((dir) => ({ profile: "pglite", dataDir: join(dir, "db") })));
});
const url = process.env.A2A_TEST_POSTGRES_URL;
if (url && !decodeURIComponent(new URL(url).pathname).includes("test")) throw new Error("Use a test database");
(url ? describe : describe.skip)("browse and track (PostgreSQL)", () => {
  it("passes the same contract", () => temporary(() => ({ profile: "postgresql", url: url! })));
});
