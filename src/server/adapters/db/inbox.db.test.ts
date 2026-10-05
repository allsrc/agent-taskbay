import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import type { DatabaseConfig } from "./config";
import { createDatabaseOrm } from "./orm";
import { createPersistenceRepositories } from "./repositories";
import { provisionIdentity } from "./identity-repository";
import { createGrant } from "./security-repository";
import { DatabaseAgentRegistry } from "./agent-registry";
import { withPrincipal } from "../auth/principal-context";
import { bootstrapDefaultLocalOrganization } from "../../application/services/bootstrap-default-organization";
import { readInbox } from "../../runtime/inbox";
import type { Principal } from "../../application/ports/identity";
import type { InboxItem } from "../../../shared/inbox-types";

const HOUR = 3_600_000;

async function contract(config: DatabaseConfig, directory: string) {
  const orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const org = await bootstrapDefaultLocalOrganization(createPersistenceRepositories(orm.em.fork()).organizations);
    const foreign = await createPersistenceRepositories(orm.em.fork()).organizations.getOrCreate({ id: randomUUID(), slug: "foreign", name: "Foreign", createdAt: new Date(), updatedAt: new Date() });
    const registry = new DatabaseAgentRegistry({ orm, environmentUrls: () => [], legacyFilePath: join(directory, "absent") });
    const agentA = await registry.add("https://a.example.test/card");
    const agentB = await registry.add("https://b.example.test/card");
    const sql = (text: string, args: unknown[] = []) => orm.em.getConnection().execute(text, args);
    const base = Date.now() - 10 * HOUR;
    let tick = 0;
    const at = () => new Date(base + (tick++) * 60_000);
    const task = async (agentId: string, state: string, title: string, skill: string | null = null) => {
      const id = randomUUID(); const when = at();
      await sql("insert into tasks (id, organization_id, agent_id, tenant, remote_task_id, remote_context_id, kind, skill_id, state, title, created_at, updated_at, terminal_at) values (?, ?, ?, '', ?, 'ctx', 'task', ?, ?, ?, ?, ?, ?)",
        [id, org.id, agentId, `remote-${id}`, skill, state, title, when, when, state.match(/COMPLETED|FAILED|CANCELED|REJECTED/) ? when : null]);
      return id;
    };
    const approval = async (taskId: string, agentId: string, status: string, risk: string, title: string, expiresInHours: number, assignee: string | null = null, organizationId = org.id) => {
      const id = randomUUID(); const when = at();
      await sql(`insert into decision_requests (id, organization_id, task_id, agent_id, tenant, skill_id, kind, status, request_key, title, summary, risk, policy_json, assigned_membership_id,
        current_revision, expires_at, created_at, updated_at, version) values (?, ?, ?, ?, '', null, 'send_message', ?, ?, ?, '', ?, '{"allowedOutcomes":["approve"],"separationOfDuties":false}', ?, 1, ?, ?, ?, 1)`,
        [id, organizationId, taskId, agentId, status, `key-${id}`, title, risk, assignee, new Date(Date.now() + expiresInHours * HOUR), when, when]);
      return id;
    };
    const person = (subject: string, role: "admin" | "operator" | "viewer", organizationId = org.id) =>
      provisionIdentity(orm.em.fork(), { issuer: "https://idp.example.test", subject, displayName: subject, organizationId, role });
    const admin = await person("admin", "admin"); const op = await person("op", "operator"); const nobody = await person("nobody", "operator"); const outsider = await person("outsider", "operator", foreign.id);
    await orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: op.membershipId, agentId: agentA.id, skillId: null, permission: "read" }));
    const as = <T>(principal: Principal, work: () => Promise<T>) => withPrincipal(principal, work);

    const tWorking = await task(agentA.id, "TASK_STATE_WORKING", "Working on A");
    const tInput = await task(agentA.id, "TASK_STATE_INPUT_REQUIRED", "Needs input A");
    const tDone = await task(agentA.id, "TASK_STATE_COMPLETED", "Done A");
    const tOther = await task(agentB.id, "TASK_STATE_INPUT_REQUIRED", "Needs input B");
    const aPending = await approval(tInput, agentA.id, "pending", "high", "Send refund", 1, op.membershipId);
    const aOverdue = await approval(tWorking, agentA.id, "pending", "low", "Stale approval", -1);
    const aApproved = await approval(tDone, agentA.id, "approved", "medium", "Closed approval", 5);
    const aOther = await approval(tOther, agentB.id, "pending", "medium", "Other agent approval", 3);
    // A different organization's rows never appear, even for an administrator.
    const foreignAgent = (await sql("select id from agents limit 1"))[0].id as string;
    void foreignAgent;
    // Assignment and due time on one task.
    await sql("insert into task_assignments (id, organization_id, task_id, assignee_membership_id, due_at, escalation_level, updated_at, version) values (?, ?, ?, ?, ?, 1, now(), 1)",
      [randomUUID(), org.id, tWorking, op.membershipId, new Date(Date.now() - HOUR)]);

    const read = async (principal: Principal, request: Parameters<typeof readInbox>[0] = {}) => as(principal, () => readInbox(request, { orm }));
    const ids = (items: InboxItem[]) => items.map((item) => item.id);

    // --- Newest first across both kinds; administrators see all four tasks and four approvals.
    const everything = await read(admin, { limit: 100 });
    expect(everything.items).toHaveLength(8);
    expect(everything.items.map((item) => item.updatedAt)).toEqual([...everything.items.map((item) => item.updatedAt)].sort().reverse());
    expect(everything.next).toBeNull();
    expect(everything.items.find((item) => item.id === aPending)).toMatchObject({ kind: "approval", risk: "high", assigneeName: "op", open: true, agentName: expect.any(String) });
    expect(everything.items.find((item) => item.id === tWorking)).toMatchObject({ kind: "task", escalationLevel: 1, assigneeName: "op", open: true });
    expect(everything.items.find((item) => item.id === tDone)).toMatchObject({ open: false });

    // --- Keyset paging walks the same order with no gaps or repeats.
    const walked: string[] = []; let cursor: string | undefined;
    do { const page = await read(admin, { limit: 3, cursor }); walked.push(...ids(page.items)); cursor = page.next ?? undefined; } while (cursor);
    expect(walked).toEqual(ids(everything.items));

    // --- Views.
    expect(ids((await read(admin, { view: "needs-input", limit: 100 })).items).sort()).toEqual([tInput, tOther, aPending, aOverdue, aOther].sort());
    expect(ids((await read(admin, { view: "active", limit: 100 })).items)).not.toContain(tDone);
    expect(ids((await read(admin, { view: "active", limit: 100 })).items)).not.toContain(aApproved);
    expect(ids((await read(admin, { view: "done", limit: 100 })).items).sort()).toEqual([tDone, aApproved].sort());
    expect(ids((await read(op, { view: "assigned", limit: 100 })).items).sort()).toEqual([tWorking, aPending].sort());
    expect(ids((await read(admin, { view: "assigned", limit: 100 })).items)).toEqual([]);
    expect(ids((await read(admin, { view: "overdue", limit: 100 })).items).sort()).toEqual([tWorking, aOverdue].sort());

    // --- Filters.
    expect(ids((await read(admin, { kind: "approval", limit: 100 })).items).sort()).toEqual([aPending, aOverdue, aApproved, aOther].sort());
    expect(ids((await read(admin, { kind: "task", agentId: agentB.id })).items)).toEqual([tOther]);
    expect(ids((await read(admin, { risk: "high" })).items)).toEqual([aPending]);
    expect(ids((await read(admin, { status: "TASK_STATE_COMPLETED" })).items)).toEqual([tDone]);
    expect(ids((await read(admin, { status: "approved" })).items)).toEqual([aApproved]);
    expect(ids((await read(admin, { agentId: agentB.id, limit: 100 })).items).sort()).toEqual([tOther, aOther].sort());
    expect((await read(admin, { updatedAfter: new Date(Date.now() + HOUR).toISOString() })).items).toEqual([]);

    // --- Authorization: only the granted agent's rows; no grant means an empty inbox; other organizations see nothing.
    expect(ids((await read(op, { limit: 100 })).items).sort()).toEqual([tWorking, tInput, tDone, aPending, aOverdue, aApproved].sort());
    expect((await read(nobody, { limit: 100 })).items).toEqual([]);
    expect((await read(outsider, { limit: 100 })).items).toEqual([]);

    // --- Validation fails closed.
    for (const bad of [{ view: "bogus" }, { kind: "x" }, { risk: "extreme" }, { agentId: "nope" }, { limit: 0 }, { limit: 101 }, { cursor: "garbage" }, { updatedAfter: "yesterday" }])
      await expect(read(admin, bad)).rejects.toMatchObject({ status: 400 });
    await expect(readInbox({}, { orm })).rejects.toBeTruthy(); // No principal, no inbox.

    // --- The read plan uses the typed indexes rather than scanning raw event payloads.
    const plan = JSON.stringify(await sql("explain select id from decision_requests where organization_id = ? order by updated_at desc limit 5", [org.id]));
    expect(plan).not.toContain("task_events");
  } finally { await orm.close(true); }
}

async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-inbox-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("INB-001 PGlite unified inbox", () => {
  it("returns an authorized, filtered, keyset-paged view over tasks and approvals", async () => {
    await temporary((directory) => contract({ profile: "pglite", dataDir: join(directory, "db") }, directory));
  });
});
const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
if (process.env.CI === "true" && !postgresUrl) throw new Error("CI must set A2A_TEST_POSTGRES_URL");
if (postgresUrl && !decodeURIComponent(new URL(postgresUrl).pathname).includes("test")) throw new Error("A2A_TEST_POSTGRES_URL must target a test database");
(postgresUrl ? describe : describe.skip)("TST-001 PostgreSQL unified inbox", () => {
  it("passes the same inbox contract", async () => {
    await temporary((directory) => contract({ profile: "postgresql", url: postgresUrl! }, directory));
  });
});
