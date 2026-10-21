import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DatabaseConfig } from "./config";
import { createDatabaseOrm } from "./orm";
import { createPersistenceRepositories } from "./repositories";
import { bootstrapDefaultLocalOrganization } from "../../application/services/bootstrap-default-organization";
import { DatabaseAgentRegistry } from "./agent-registry";
import { provisionIdentity } from "./identity-repository";
import { createGrant } from "./security-repository";
import { SecurityAuditEntity, TaskLinkEntity } from "./entities";
import { withPrincipal } from "../auth/principal-context";
import { createTaskObserver, withTaskQueries } from "../../runtime/task-persistence";
import { createProjectionRebuilder } from "../../runtime/projection-rebuild";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { recordCancelRelatedAudit } from "../../runtime/audit";
import { createAuditService } from "../../runtime/audit";
import { acceptCommand } from "../../runtime/commands";
import type { JsonValue, TaskRecord } from "../../domain/persistence-model";

async function contract(config: DatabaseConfig, directory: string) {
  let orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up({ to: "Migration0007_ExtendedCardKind" });
    const repos = () => createPersistenceRepositories(orm.em.fork());
    const registry = () => new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    // Written as SQL: this schema predates the entity's newest columns.
    const org = await bootstrapDefaultLocalOrganization(repos().organizations);
    const agent = { id: randomUUID(), cardUrl: "https://links.test/card.json" };
    await orm.em.getConnection().execute(`insert into "agents" ("id", "organization_id", "card_url", "source", "enabled", "created_at", "updated_at") values (?, ?, ?, 'managed', true, now(), now())`, [agent.id, org.id, agent.cardUrl]);
    const now = new Date();
    const old: TaskRecord = { id: randomUUID(), organizationId: org.id, agentId: agent.id, tenant: "", remoteTaskId: "before-upgrade",
      remoteContextId: null, kind: "task", state: "TASK_STATE_COMPLETED", title: "Kept on upgrade", ownerUserId: null, ownerTeamId: null,
      createdAt: now, remoteCreatedAt: null, updatedAt: now, remoteUpdatedAt: null, terminalAt: now, version: 1, contentJson: {} };
    await repos().tasks.insert(old);
    await orm.migrator.up();
    expect((await repos().tasks.findById(org.id, old.id))?.title).toBe("Kept on upgrade");
    expect(await orm.em.fork().count(TaskLinkEntity, {})).toBe(0);
    expect(await orm.migrator.checkSchema()).toBe(false);
    const store = new FilesystemArtifactStore(join(directory, "objects"));
    const observe = (skillId: string | null = null, tenant = "", agentId = agent.id, organizationId = org.id, userMessage?: JsonValue) => createTaskObserver({
      organizationId, agentId, tenant, skillId, userMessage, sessionId: randomUUID(), requestId: randomUUID(),
    }, { orm, store, manageSubscription: false, managePush: false });
    const event = (id: string, title: string, refs?: string[]): JsonValue => ({ task: { id, contextId: `ctx-${id}`, status: { state: "TASK_STATE_WORKING" },
      history: [{ messageId: `agent-${id}`, role: "ROLE_AGENT", parts: [{ text: title }], ...(refs ? { referenceTaskIds: refs } : {}) }] } });
    const read = (id: string, organizationId = org.id) => withTaskQueries((query) => query.detail(organizationId, id), orm, store);
    const a = await observe("private")(event("A", "Hidden task title"));
    const c = await observe("public")(event("C", "Visible task"));
    const tenantTarget = await observe(null, "other-tenant")(event("tenant-only", "Other tenant"));
    const otherAgent = await registry().add("https://other-agent.test/card.json");
    const agentTarget = await observe(null, "", otherAgent.id)(event("agent-only", "Other agent"));
    const foreignOrg = await repos().organizations.getOrCreate({ id: randomUUID(), slug: "foreign-links", name: "Foreign", createdAt: now, updatedAt: now });
    const foreignAgent = await repos().agents.getOrCreate({ id: randomUUID(), organizationId: foreignOrg.id, cardUrl: agent.cardUrl, source: "managed", enabled: true,
      displayName: "Foreign", description: null, protocolSnapshotVersion: null, lastDiscoveryAt: null, lastHealthyAt: null, createdAt: now, updatedAt: now });
    const foreign = await observe(null, "", foreignAgent.id, foreignOrg.id)(event("foreign-only", "Foreign secret title"));
    const sameIds = [
      await observe(null, "other-tenant")(event("A", "Tenant A")),
      await observe(null, "", otherAgent.id)(event("A", "Other agent A")),
      await observe(null, "", foreignAgent.id, foreignOrg.id)(event("A", "Foreign A")),
    ];
    const user: JsonValue = { messageId: "user-B", role: "ROLE_USER", parts: [{ text: "Continue work" }], referenceTaskIds: ["A", "A", "unknown", "tenant-only", "agent-only", "foreign-only"] };
    const bEvent = event("B", "Agent follows C", ["C"]);
    const ingestB = observe("public", "", agent.id, org.id, user);
    const b = await ingestB(bEvent);
    const before = (await read(b.localId))!;
    expect(before.related?.references.map((task) => task.taskId).sort()).toEqual(["A", "C"]);
    expect(before.referenceLinks).toEqual({ A: a.localId, C: c.localId });
    expect((await read(a.localId))?.related?.referencedBy.map((task) => task.localId)).toEqual([b.localId]);
    expect((await read(tenantTarget.localId))?.related).toEqual({ references: [], referencedBy: [] });
    expect((await read(agentTarget.localId))?.related).toEqual({ references: [], referencedBy: [] });
    expect((await read(foreign.localId, foreignOrg.id))?.related).toEqual({ references: [], referencedBy: [] });
    const linksBefore = await orm.em.fork().find(TaskLinkEntity, {}, { orderBy: { toTaskId: "asc" } });
    expect(linksBefore).toHaveLength(2);
    expect(linksBefore.every((link) => sameIds.every((task) => task.localId !== link.toTaskId))).toBe(true);
    await ingestB(bEvent);
    await createProjectionRebuilder({ orm, store }).rebuild(org.id, b.localId);
    await createProjectionRebuilder({ orm, store }).rebuild(org.id, b.localId);
    expect(await orm.em.fork().find(TaskLinkEntity, {}, { orderBy: { toTaskId: "asc" } })).toEqual(linksBefore);
    expect((await read(b.localId))?.related).toEqual(before.related);
    // Rebuilding reconstructs lost derived links from both the user and agent messages.
    await orm.em.fork().nativeDelete(TaskLinkEntity, {});
    await createProjectionRebuilder({ orm, store }).rebuild(org.id, b.localId);
    expect((await read(b.localId))?.related).toEqual(before.related);
    expect(await orm.em.fork().count(TaskLinkEntity, {})).toBe(2);
    // A cycle remains a graph, with a task in both direction groups, without recursion.
    await observe("private")({ message: { messageId: "cycle", role: "ROLE_AGENT", taskId: "A", contextId: "ctx-A", parts: [{ text: "See B" }], referenceTaskIds: ["B"] } });
    expect((await read(b.localId))?.related?.referencedBy.map((task) => task.taskId)).toEqual(["A"]);
    const admin = await provisionIdentity(orm.em.fork(), { issuer: "links-idp", subject: "admin", organizationId: org.id, displayName: "Admin", role: "admin" });
    const member = await provisionIdentity(orm.em.fork(), { issuer: "links-idp", subject: "member", organizationId: org.id, displayName: "Member", role: "operator" });
    const outsider = await provisionIdentity(orm.em.fork(), { issuer: "links-idp", subject: "outsider", organizationId: foreignOrg.id, displayName: "Outsider", role: "admin" });
    await orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: member.membershipId, agentId: agent.id, skillId: "public", permission: "read" }));
    const restricted = await withPrincipal(member, () => read(b.localId));
    expect(restricted?.related?.references.map((task) => task.taskId)).toEqual(["C"]);
    expect(restricted?.related?.referencedBy).toEqual([]);
    expect(JSON.stringify(restricted?.related)).not.toContain("Hidden task title");
    expect(JSON.stringify(restricted?.related)).not.toContain(a.localId);
    expect(restricted?.referenceLinks).toEqual({ C: c.localId });
    const d = await withPrincipal(member, () => observe("public")(event("D", "Agent mentions hidden work", ["A"])));
    expect((await read(d.localId))?.related?.references.map((task) => task.taskId)).toEqual(["A"]);
    expect((await withPrincipal(member, () => read(d.localId)))?.related).toEqual({ references: [], referencedBy: [] });
    expect(await withPrincipal(member, () => read(a.localId))).toBeUndefined();
    expect(await withPrincipal(outsider, () => read(b.localId, foreignOrg.id))).toBeUndefined();
    expect(await withPrincipal(member, () => repos().taskLinks.findRelated(org.id, a.localId))).toEqual({ references: [], referencedBy: [] });
    // Even a malformed stored relationship cannot cross an organization on read.
    await orm.em.fork().insert(TaskLinkEntity, { id: randomUUID(), organizationId: org.id, fromTaskId: b.localId, toTaskId: foreign.localId, kind: "references", createdAt: now });
    expect(JSON.stringify((await read(b.localId))?.related)).not.toContain("Foreign secret title");
    const row = (await repos().tasks.findById(org.id, b.localId))!;
    await repos().taskLinks.recordReferences({ ...row, organizationId: foreignOrg.id }, ["foreign-only"], now);
    expect(await orm.em.fork().count(TaskLinkEntity, { organizationId: foreignOrg.id })).toBe(0);
    // Cancellation permissions use the caller's role and agent/skill grants, independent of read visibility.
    expect((await withPrincipal(admin, () => read(b.localId)))?.canOperate).toBe(true);
    expect((await withPrincipal(admin, () => read(b.localId)))?.related?.references.every((task) => task.canOperate && task.cancelable)).toBe(true);
    expect(restricted?.canOperate).toBe(false);
    expect(restricted?.related?.references.every((task) => !task.canOperate && task.cancelable)).toBe(true);
    await orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: member.membershipId, agentId: agent.id, skillId: "public", permission: "operate" }));
    await orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: member.membershipId, agentId: agent.id, skillId: "private", permission: "read" }));
    const scoped = await withPrincipal(member, () => read(b.localId));
    expect(scoped?.canOperate).toBe(true);
    expect(scoped?.related?.references.map(({ taskId, canOperate }) => ({ taskId, canOperate }))).toEqual([{ taskId: "A", canOperate: false }, { taskId: "C", canOperate: true }]);
    // A forged client choice still cannot cancel a task with only read permission.
    await expect(withPrincipal(member, () => acceptCommand(agent.id, { action: "cancelTask", taskId: "A" }, randomUUID(), { orm, store }))).rejects.toMatchObject({ status: 403 });
    const viewer = await provisionIdentity(orm.em.fork(), { issuer: "links-idp", subject: "viewer", organizationId: org.id, displayName: "Viewer", role: "viewer" });
    await orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: viewer.membershipId, agentId: agent.id, skillId: null, permission: "operate" }));
    expect((await withPrincipal(viewer, () => read(b.localId)))?.related?.references.every((task) => !task.canOperate)).toBe(true);
    await expect(withPrincipal(viewer, () => acceptCommand(agent.id, { action: "cancelTask", taskId: "C" }, randomUUID(), { orm, store }))).rejects.toMatchObject({ status: 403 });
    const whole = await provisionIdentity(orm.em.fork(), { issuer: "links-idp", subject: "whole", organizationId: org.id, displayName: "Whole agent", role: "operator" });
    await orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: whole.membershipId, agentId: agent.id, skillId: null, permission: "operate" }));
    expect((await withPrincipal(whole, () => read(b.localId)))?.related?.references.every((task) => task.canOperate)).toBe(true);
    // A terminal task stays visible but is never eligible on reload.
    await observe("public")({ task: { id: "C", contextId: "ctx-C", status: { state: "TASK_STATE_CANCELED" } } });
    expect((await withPrincipal(admin, () => read(b.localId)))?.related?.references.find((task) => task.taskId === "C")).toMatchObject({ canOperate: true, cancelable: false });
    expect((await withPrincipal(admin, () => read(c.localId)))?.cancelable).toBe(false);
    await expect(withPrincipal(admin, () => acceptCommand(agent.id, { action: "cancelTask", taskId: "C" }, randomUUID(), { orm, store }))).rejects.toMatchObject({ status: 409, kind: "task_terminal" });
    // Even a stored cross-agent edge is read-only for someone without an operate grant on that agent.
    await orm.em.fork().insert(TaskLinkEntity, { id: randomUUID(), organizationId: org.id, fromTaskId: b.localId, toTaskId: agentTarget.localId, kind: "references", createdAt: now });
    await orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: member.membershipId, agentId: otherAgent.id, skillId: null, permission: "read" }));
    expect((await withPrincipal(member, () => read(b.localId)))?.related?.references.find((task) => task.localId === agentTarget.localId)).toMatchObject({ canOperate: false, cancelable: true });
    await expect(withPrincipal(member, () => acceptCommand(otherAgent.id, { action: "cancelTask", taskId: "agent-only" }, randomUUID(), { orm, store }))).rejects.toMatchObject({ status: 403 });
    // Counts-only summaries are scoped, immutable, and idempotent across retries and instances.
    const summary = { runId: randomUUID(), requested: 3, canceled: 1, refused: 1, failed: 1 };
    await withPrincipal(member, () => recordCancelRelatedAudit(member, b.localId, summary, { orm }));
    await withPrincipal(member, () => recordCancelRelatedAudit(member, b.localId, summary, { orm }));
    expect(await orm.em.fork().count(SecurityAuditEntity, { action: "task.cancel.related" })).toBe(1);
    const audit = await withPrincipal(member, () => createAuditService({ orm }).page(member, { taskId: b.localId, group: "commands", limit: 10 }));
    expect(audit.entries.find((entry) => entry.kind === "task.cancel.related")).toMatchObject({ taskId: b.localId, data: { requested: 3, canceled: 1, refused: 1, failed: 1 } });
    expect(JSON.stringify(audit.entries)).not.toContain("Hidden task title");
    await expect(withPrincipal(outsider, () => recordCancelRelatedAudit(outsider, b.localId, summary, { orm }))).rejects.toMatchObject({ status: 404 });
    await expect(withPrincipal(viewer, () => recordCancelRelatedAudit(viewer, b.localId, summary, { orm }))).rejects.toMatchObject({ status: 403 });
    await expect(withPrincipal(admin, () => recordCancelRelatedAudit(admin, b.localId, { ...summary, requested: 2 }, { orm }))).rejects.toMatchObject({ status: 400 });
    // Removing an agent disables it; historical tasks and their links remain readable.
    await registry().remove(agent.id);
    const disabled = await read(b.localId);
    expect(disabled?.related?.references.map((task) => task.taskId).sort()).toEqual(["A", "C", "agent-only"]);
    expect(disabled?.related?.references.find((task) => task.taskId === "C")?.state).toBe("TASK_STATE_CANCELED");
    await orm.close(true); orm = await createDatabaseOrm(config);
    expect((await read(b.localId))?.related).toEqual(disabled?.related);
    const summaries = await withTaskQueries((query, organizationId) => query.list(organizationId), orm, store);
    expect(summaries.every((task) => (task as { related?: unknown }).related === undefined)).toBe(true);
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally { await orm.close(true); }
}
async function temporary(config: (directory: string) => DatabaseConfig) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-task-links-"));
  try { await contract(config(directory), directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("related tasks (PGlite)", () => {
  it("upgrades, derives both directions, replays, rebuilds and enforces identity and grant boundaries", () => temporary((dir) => ({ profile: "pglite", dataDir: join(dir, "db") })));
});
const url = process.env.A2A_TEST_POSTGRES_URL;
if (url && !decodeURIComponent(new URL(url).pathname).includes("test")) throw new Error("Use a test database");
(url ? describe : describe.skip)("related tasks (PostgreSQL)", () => {
  it("passes the same upgrade and isolation contract", () => temporary(() => ({ profile: "postgresql", url: url! })));
});
