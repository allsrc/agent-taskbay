import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabaseOrm } from "./orm";
import type { DatabaseConfig } from "./config";
import { createPersistenceRepositories } from "./repositories";
import { DatabaseAgentRegistry } from "./agent-registry";
import { provisionIdentity } from "./identity-repository";
import { createGrant } from "./security-repository";
import { withPrincipal } from "../auth/principal-context";
import { createTaskObserver, withTaskQueries } from "../../runtime/task-persistence";
import { createProjectionRebuilder } from "../../runtime/projection-rebuild";
import { refreshTaskHistory } from "../../runtime/task-history";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { OutboxMessageEntity, RateBucketEntity, TaskEventEntity } from "./entities";
import type { JsonValue } from "../../domain/persistence-model";

// Loading the agent's history stores what only the agent has, labels it, and never duplicates or relabels what Taskbay received itself.
const message = (id: string) => ({ messageId: id, role: id.startsWith("u") ? "ROLE_USER" : "ROLE_AGENT", parts: [{ text: `Text of ${id}` }] });
const ids = (count: number) => Array.from({ length: count }, (_, index) => (index % 2 ? `a${index}` : `u${index}`));
const snapshot = (remoteId: string, history: string[], state = "TASK_STATE_WORKING"): JsonValue =>
  ({ task: { id: remoteId, contextId: `ctx-${remoteId}`, status: { state, timestamp: "2026-10-03T00:00:00Z" }, history: history.map(message), artifacts: [], metadata: { tenant: "" } } });

async function contract(config: DatabaseConfig, directory: string) {
  const orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const store = new FilesystemArtifactStore(join(directory, "artifacts"));
    const registry = new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    const agent = await registry.add("https://agent.test/card");
    const org = (await createPersistenceRepositories(orm.em.fork()).organizations.findBySlug("local"))!;
    const foreign = await createPersistenceRepositories(orm.em.fork()).organizations.getOrCreate({ id: randomUUID(), slug: "foreign", name: "Foreign", createdAt: new Date(), updatedAt: new Date() });
    const person = (subject: string, role: "admin" | "operator" | "viewer", organizationId = org.id) => provisionIdentity(orm.em.fork(), { issuer: "https://idp.test", subject, organizationId, displayName: subject, role });
    const admin = await person("admin", "admin");
    const whole = await person("whole", "operator");
    const skillScoped = await person("skill", "operator");
    const viewer = await person("viewer", "viewer");
    const nobody = await person("nobody", "operator");
    const outsider = await person("outsider", "admin", foreign.id);
    const grant = (membershipId: string, skillId: string | null) => orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: membershipId, agentId: agent.id, skillId, permission: "operate" }));
    await grant(whole.membershipId, null);
    await grant(skillScoped.membershipId, "public");
    await grant(viewer.membershipId, null);

    // Taskbay saw three messages of "t1" itself (one went out, two came in live).
    const observe = (event: JsonValue, skillId: string | null = null) => createTaskObserver({ organizationId: org.id, agentId: agent.id, sessionId: randomUUID(), requestId: randomUUID(), source: "stream", skillId }, { orm, store })(event);
    const live = await observe(snapshot("t1", ["u0", "a1", "u2"]));
    const forSkill = await observe(snapshot("t2", ["u0"]), "public");
    expect(live.messages.map((item) => item.id)).toEqual(["u0", "a1", "u2"]);
    const direct = await createTaskObserver({ organizationId: org.id, agentId: agent.id, sessionId: randomUUID(), requestId: randomUUID(), source: "command_response" }, { orm, store })({ message: { ...message("a-direct"), contextId: "c" } });

    // The agent holds ten history messages for t1.
    const remote = new Map<string, JsonValue>([["t1", snapshot("t1", ids(10))], ["t2", snapshot("t2", ["u0", "a1"])]]);
    const asked: Array<{ id: string | null; length: number | undefined }> = [];
    let failure: unknown;
    const gateway = { async get(_agent: unknown, task: { remoteTaskId: string | null }, _signal: AbortSignal, length?: number) {
      asked.push({ id: task.remoteTaskId, length });
      if (failure) throw failure;
      return remote.get(task.remoteTaskId!)!;
    } };
    const options = { orm, gateway: gateway as never, store };
    const refresh = (who: typeof admin, id: string, input: { historyLength?: number } = {}) => withPrincipal(who, () => refreshTaskHistory(id, input, options));
    const detail = (who: typeof admin, id: string) => withPrincipal(who, () => withTaskQueries((queries, organizationId) => queries.detail(organizationId, id), orm));
    const ledger = (id: string) => orm.em.fork().count(TaskEventEntity, { taskId: id });

    // Loading returns the seven entries Taskbay did not have, labelled; what it received live keeps its provenance.
    const first = await refresh(whole, live.localId);
    expect(asked.at(-1)).toEqual({ id: "t1", length: 50 });
    expect(first).toMatchObject({ added: 7, total: 7 });
    const labelled = first.task.messages.filter((item) => item.origin === "agent-history").map((item) => item.id);
    expect(labelled).toEqual(ids(10).filter((id) => !["u0", "a1", "u2"].includes(id)));
    expect(first.task.messages.filter((item) => !item.origin).map((item) => item.id)).toEqual(["u0", "a1", "u2"]);
    expect(first.task.messages).toHaveLength(10);
    expect((await detail(whole, live.localId))!.messages.filter((item) => item.origin === "agent-history")).toHaveLength(7);
    const afterFirst = await ledger(live.localId);

    // Loading again adds nothing: the same answer is the same ledger entry.
    expect(await refresh(whole, live.localId)).toMatchObject({ added: 0, total: 7 });
    expect(await ledger(live.localId)).toBe(afterFirst);
    // A different length with the same messages adds a ledger entry but no message.
    expect(await refresh(whole, live.localId, { historyLength: 5 })).toMatchObject({ added: 0, total: 7 });
    expect(asked.at(-1)).toEqual({ id: "t1", length: 5 });

    // Rebuilding the projection from the ledger keeps the labels.
    const before = await detail(whole, live.localId);
    const rebuilt = await createProjectionRebuilder({ orm, store }).rebuild(org.id, live.localId);
    expect(rebuilt.messages.map((item) => [item.id, item.origin ?? null])).toEqual(before!.messages.map((item) => [item.id, item.origin ?? null]));
    expect(rebuilt.messages.filter((item) => item.origin === "agent-history")).toHaveLength(7);

    // Taskbay's own read of the task later (the agent's current answer) does not turn history into something received live.
    await createTaskObserver({ organizationId: org.id, agentId: agent.id, sessionId: randomUUID(), requestId: randomUUID(), source: "reconcile" }, { orm, store })(snapshot("t1", ids(10), "TASK_STATE_COMPLETED"));
    expect((await detail(whole, live.localId))!.messages.filter((item) => item.origin === "agent-history")).toHaveLength(7);

    // Access is the task's agent and skill, like any task route: no access is "not found"; a viewer cannot operate.
    await expect(refresh(skillScoped, live.localId)).rejects.toMatchObject({ status: 404 });
    await expect(refresh(nobody, live.localId)).rejects.toMatchObject({ status: 404 });
    await expect(refresh(outsider, live.localId)).rejects.toMatchObject({ status: 404 });
    await expect(refresh(viewer, live.localId)).rejects.toBeDefined();
    expect(await refresh(skillScoped, forSkill.localId)).toMatchObject({ added: 1, total: 1 });
    await expect(refresh(whole, "not-an-id")).rejects.toMatchObject({ status: 404 });

    // Only a task that exists on the agent has history to load.
    await expect(refresh(admin, direct.localId)).rejects.toMatchObject({ status: 409, kind: "no_remote_task" });
    // The length is checked before anything else happens.
    const calls = asked.length;
    for (const historyLength of [0, 201, 1.5]) await expect(refresh(admin, live.localId, { historyLength })).rejects.toMatchObject({ status: 400 });
    expect(asked).toHaveLength(calls);

    // Failures store nothing, and say what happened by kind.
    const broken = await observe(snapshot("t4", ["u0"]));
    const stored = { events: await ledger(broken.localId), outbox: await orm.em.fork().count(OutboxMessageEntity, {}) };
    const unchanged = async () => expect({ events: await ledger(broken.localId), outbox: await orm.em.fork().count(OutboxMessageEntity, {}) }).toEqual(stored);
    failure = Object.assign(new Error("gone"), { name: "TaskNotFoundError", reason: "TASK_NOT_FOUND", envelopeCode: -32001 });
    await expect(refresh(admin, broken.localId)).rejects.toMatchObject({ status: 409, kind: "task_not_found" });
    failure = Object.assign(new Error("nope"), { name: "UnsupportedOperationError", envelopeCode: -32004 });
    await expect(refresh(admin, broken.localId)).rejects.toMatchObject({ status: 502, kind: "unsupported_operation" });
    failure = new Error("connect ECONNREFUSED");
    await expect(refresh(admin, broken.localId)).rejects.toMatchObject({ status: 502, kind: "agent_unavailable", message: "The agent could not be reached." });
    failure = undefined;
    remote.set("t4", snapshot("other", ["a1"]));
    await expect(refresh(admin, broken.localId)).rejects.toMatchObject({ status: 502, kind: "agent_response_invalid" });
    remote.set("t4", { task: { id: "t4", contextId: "foreign", status: { state: "TASK_STATE_WORKING" }, history: [message("a99")] } });
    await expect(refresh(admin, broken.localId)).rejects.toMatchObject({ status: 502, kind: "agent_response_invalid" });
    await unchanged();

    // The limit is six a minute for each task, kept in the database; another task is not held back.
    const limited = await observe(snapshot("t3", ["u0"]));
    remote.set("t3", snapshot("t3", ["u0", "a1"]));
    for (let call = 0; call < 6; call++) await refresh(whole, limited.localId, { historyLength: call + 1 });
    await expect(refresh(whole, limited.localId)).rejects.toMatchObject({ status: 429 });
    await expect(refresh(admin, limited.localId)).rejects.toMatchObject({ status: 429 });
    expect(await orm.em.fork().count(RateBucketEntity, { id: `history:refresh:${limited.localId}` })).toBe(1);
    expect(await refresh(admin, forSkill.localId)).toMatchObject({ added: 0 });
  } finally { await orm.close(true); }
}

async function temporary(config: (directory: string) => DatabaseConfig) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-history-"));
  try { await contract(config(directory), directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("agent history on demand (PGlite)", () => {
  it("labels what only the agent has and keeps to its rules", () => temporary((dir) => ({ profile: "pglite", dataDir: join(dir, "db") })));
});
const url = process.env.A2A_TEST_POSTGRES_URL;
if (url && !decodeURIComponent(new URL(url).pathname).includes("test")) throw new Error("Use a test database");
(url ? describe : describe.skip)("agent history on demand (PostgreSQL)", () => {
  it("passes the same contract", () => temporary(() => ({ profile: "postgresql", url: url! })));
});
