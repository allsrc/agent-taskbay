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
import { TeamEntity, TeamMembershipEntity } from "./entities";
import { withPrincipal } from "../auth/principal-context";
import { withTaskQueries } from "../../runtime/task-persistence";
import { decodeTaskCursor } from "../../domain/task-cursor";
import type { TaskListQuery } from "../../application/ports/persistence";
import type { TaskRecord } from "../../domain/persistence-model";

// Filters, cursor paging with tied update times, context siblings, and visibility for a skill-scoped member and a second organization.
const base = Date.parse("2026-10-01T00:00:00.000Z");

async function contract(config: DatabaseConfig, directory: string) {
  const orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const registry = new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    const agentA = await registry.add("https://agent-a.test/card");
    const agentB = await registry.add("https://agent-b.test/card");
    const ports = createPersistenceRepositories(orm.em.fork());
    const org = (await ports.organizations.findBySlug("local"))!;
    const otherOrg = await ports.organizations.getOrCreate({ id: randomUUID(), slug: "other", name: "Other", createdAt: new Date(base), updatedAt: new Date(base) });
    const foreignAgent = await ports.agents.insert({ id: randomUUID(), organizationId: otherOrg.id, cardUrl: "https://foreign.test/card", source: "managed", enabled: true,
      displayName: "Foreign", description: null, protocolSnapshotVersion: null, lastDiscoveryAt: null, lastHealthyAt: null, createdAt: new Date(base), updatedAt: new Date(base) });
    const admin = await provisionIdentity(orm.em.fork(), { issuer: "https://idp.test", subject: "admin", organizationId: org.id, displayName: "Admin", role: "admin" });
    const foreignAdmin = await provisionIdentity(orm.em.fork(), { issuer: "https://idp.test", subject: "foreign", organizationId: otherOrg.id, displayName: "Foreign", role: "admin" });
    const member = await provisionIdentity(orm.em.fork(), { issuer: "https://idp.test", subject: "operator", organizationId: org.id, displayName: "Operator", role: "operator" });
    const teamId = randomUUID();
    await orm.em.fork().insert(TeamEntity, { id: teamId, organizationId: org.id, name: "Operations", enabled: true });
    await orm.em.fork().insert(TeamMembershipEntity, { id: randomUUID(), teamId, membershipId: member.membershipId });
    await orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "team", subjectId: teamId, agentId: agentA.id, skillId: "public", permission: "read" }));

    const insert = (organizationId: string, agentId: string, index: number, extra: Partial<TaskRecord> = {}) => ports.tasks.insert({
      id: randomUUID(), organizationId, agentId, tenant: "", remoteTaskId: `task-${agentId.slice(0, 4)}-${index}`, remoteContextId: null, kind: "task",
      state: "TASK_STATE_WORKING", title: `Task ${index}`, ownerUserId: null, ownerTeamId: null, skillId: "public", origin: "created",
      createdAt: new Date(base), remoteCreatedAt: null, updatedAt: new Date(base), remoteUpdatedAt: null, terminalAt: null, version: 1, contentJson: {}, ...extra });
    // 130 tasks for agent A. Update times repeat in groups of 13, so every page boundary can fall inside a tie.
    const seeded: TaskRecord[] = [];
    for (let index = 0; index < 130; index += 1) {
      seeded.push(await insert(org.id, agentA.id, index, {
        updatedAt: new Date(base + Math.floor(index / 13) * 60_000), skillId: index % 2 ? "private" : "public",
        remoteContextId: index < 40 ? `ctx-${index % 4}` : null, tenant: index % 10 === 3 ? "tenant-b" : "",
        origin: index % 5 === 0 ? "discovered" : "created", state: index % 7 === 0 ? "TASK_STATE_COMPLETED" : "TASK_STATE_WORKING",
      }));
    }
    for (let index = 0; index < 3; index += 1) await insert(org.id, agentB.id, index, { remoteContextId: "ctx-0" });
    await insert(otherOrg.id, foreignAgent.id, 0, { remoteContextId: "ctx-0" });

    const order = (rows: TaskRecord[]) => [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? -1 : 1)).map((row) => row.id);
    const list = (principal: typeof admin, query: Partial<TaskListQuery> = {}) =>
      withPrincipal(principal, () => withTaskQueries((queries, id) => queries.listPage(id, { limit: 50, ...query }), orm));
    const ids = async (principal: typeof admin, query: Partial<TaskListQuery>) => (await list(principal, { limit: 100, ...query })).tasks.map((task) => task.localId);
    const expected = (predicate: (task: TaskRecord) => boolean, rows = seeded) => order(rows.filter(predicate));

    // Paging: each task exactly once, in order, across ties.
    const paged: string[] = [];
    for (let after: string | null | undefined, pages = 0; pages < 10; pages += 1) {
      const page = await list(admin, { after: after ? decodeTaskCursor(after) : undefined });
      paged.push(...page.tasks.map((task) => task.localId));
      if (!page.next) { expect(page.tasks.length).toBe(33); break; }
      expect(page.tasks).toHaveLength(50);
      after = page.next;
    }
    const agentAOnly = order(seeded);
    expect(paged.filter((id) => agentAOnly.includes(id))).toEqual(agentAOnly);
    expect(new Set(paged).size).toBe(paged.length);
    expect(paged).toHaveLength(133);
    // Offset still works and agrees with the cursor order.
    const offsetPage = await list(admin, { offset: 50 });
    expect(offsetPage.tasks.map((task) => task.localId)).toEqual(paged.slice(50, 100));
    expect(offsetPage.next).not.toBeNull();
    expect((await list(admin, { offset: 100 })).next).toBeNull();

    // Each filter alone and combined.
    expect(await ids(admin, { agentId: agentB.id })).toHaveLength(3);
    expect(await ids(admin, { contextId: "ctx-1" })).toEqual(expected((task) => task.remoteContextId === "ctx-1"));
    expect(await ids(admin, { contextId: "ctx-0", agentId: agentB.id })).toHaveLength(3);
    expect(await ids(admin, { contextId: "ctx-0" })).toHaveLength(10 + 3);
    expect(await ids(admin, { origin: "discovered" })).toEqual(expected((task) => task.origin === "discovered"));
    const cutoff = new Date(base + 8 * 60_000);
    expect(await ids(admin, { updatedAfter: cutoff, agentId: agentA.id })).toEqual(expected((task) => task.updatedAt > cutoff));
    expect(await ids(admin, { updatedAfter: cutoff, origin: "discovered", contextId: "ctx-0" })).toEqual(expected((task) => task.updatedAt > cutoff && task.origin === "discovered" && task.remoteContextId === "ctx-0"));
    expect(await ids(admin, { filter: "done", contextId: "ctx-0" })).toEqual(expected((task) => task.state === "TASK_STATE_COMPLETED" && task.remoteContextId === "ctx-0"));
    // A cursor combines with a filter.
    const first = await list(admin, { limit: 5, origin: "discovered" });
    const second = await list(admin, { limit: 5, origin: "discovered", after: decodeTaskCursor(first.next!) });
    expect([...first.tasks, ...second.tasks].map((task) => task.localId)).toEqual(expected((task) => task.origin === "discovered").slice(0, 10));

    // A skill-scoped member sees only the public tasks of agent A, whatever the filters say.
    const visible = (task: TaskRecord) => task.skillId === "public";
    expect(await ids(member, {})).toEqual(expected(visible));
    expect(await ids(member, { agentId: agentB.id })).toEqual([]);
    expect(await ids(member, { contextId: "ctx-0", agentId: agentA.id })).toEqual(expected((task) => visible(task) && task.remoteContextId === "ctx-0"));
    expect(await ids(member, { origin: "discovered", updatedAfter: cutoff })).toEqual(expected((task) => visible(task) && task.origin === "discovered" && task.updatedAt > cutoff));
    const memberPaged: string[] = [];
    for (let after: string | null = null, pages = 0; pages < 5; pages += 1) {
      const page: Awaited<ReturnType<typeof list>> = await list(member, { limit: 20, after: after ? decodeTaskCursor(after) : undefined });
      memberPaged.push(...page.tasks.map((task) => task.localId));
      if (!(after = page.next)) break;
    }
    expect(memberPaged).toEqual(expected(visible));

    // Another organization sees none of this, and its own task is not reachable with our filters.
    expect(await ids(foreignAdmin, {})).toHaveLength(1);
    expect(await ids(foreignAdmin, { agentId: agentA.id })).toEqual([]);
    expect(await ids(foreignAdmin, { contextId: "ctx-0", agentId: foreignAgent.id })).toHaveLength(1);

    // Context siblings: same agent, tenant and context; never the task itself; newest first; only what the reader may see.
    const detail = (principal: typeof admin, id: string) => withPrincipal(principal, () => withTaskQueries((queries, organizationId) => queries.detail(organizationId, id), orm));
    const inContext = seeded.filter((task) => task.remoteContextId === "ctx-0" && task.tenant === "");
    const subject = inContext.find((task) => task.skillId === "public")!;
    const adminView = await detail(admin, subject.id);
    expect(adminView!.contextSiblings!.map((sibling) => sibling.localId)).toEqual(order(inContext.filter((task) => task.id !== subject.id)));
    expect(adminView!.contextSiblings![0]).toMatchObject({ taskId: expect.any(String), state: expect.any(String), title: expect.any(String), updatedAt: expect.any(String) });
    const memberView = await detail(member, subject.id);
    expect(memberView!.contextSiblings!.map((sibling) => sibling.localId)).toEqual(order(inContext.filter((task) => task.id !== subject.id && task.skillId === "public")));
    // Another tenant's tasks in the same context id are not siblings.
    expect(adminView!.contextSiblings!.map((sibling) => sibling.localId)).not.toContain(seeded.find((task) => task.tenant === "tenant-b" && task.remoteContextId === "ctx-0")?.id ?? "none");
    // At most 20, even with more in the context.
    for (let index = 200; index < 230; index += 1) await insert(org.id, agentB.id, index, { remoteContextId: "big", updatedAt: new Date(base + index) });
    const big = (await ids(admin, { contextId: "big" }));
    expect((await detail(admin, big[0]))!.contextSiblings).toHaveLength(20);
    // No context: no siblings.
    expect((await detail(admin, seeded.find((task) => !task.remoteContextId)!.id))!.contextSiblings).toEqual([]);
    expect(await detail(foreignAdmin, subject.id)).toBeUndefined();
  } finally { await orm.close(true); }
}
async function temporary(config: (directory: string) => DatabaseConfig) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-task-list-"));
  try { await contract(config(directory), directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("task list filters, cursor paging and context siblings (PGlite)", () => {
  it("pages 130 tasks once each, narrows by filters, and respects skill scope and organizations", () => temporary((dir) => ({ profile: "pglite", dataDir: join(dir, "db") })), 120_000);
});
const url = process.env.A2A_TEST_POSTGRES_URL;
if (url && !decodeURIComponent(new URL(url).pathname).includes("test")) throw new Error("Use a test database");
(url ? describe : describe.skip)("task list filters, cursor paging and context siblings (PostgreSQL)", () => {
  it("passes the same contract", () => temporary(() => ({ profile: "postgresql", url: url! })), 120_000);
});
