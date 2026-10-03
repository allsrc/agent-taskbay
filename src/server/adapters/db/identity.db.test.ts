import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import type { DatabaseConfig } from "./config";
import { createDatabaseOrm } from "./orm";
import { createPersistenceRepositories } from "./repositories";
import { DatabaseIdentityRepository, provisionIdentity } from "./identity-repository";
import { MembershipEntity, UserEntity, UserSessionEntity, LoginAttemptEntity, SecurityAuditEntity } from "./entities";
import { tokenHash, opaqueToken, sealFlow } from "../auth/oidc";
import { withPrincipal } from "../auth/principal-context";
import { DatabaseAgentRegistry } from "./agent-registry";
import { acceptCommand, readCommand } from "../../runtime/commands";
import { withTaskQueries } from "../../runtime/task-persistence";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { bootstrapDefaultLocalOrganization } from "../../application/services/bootstrap-default-organization";

async function contract(config: DatabaseConfig, directory: string) {
  let orm = await createDatabaseOrm(config);
  const store = new FilesystemArtifactStore(join(directory, "artifacts"));
  const identities = () => new DatabaseIdentityRepository(orm.em.fork());
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up({ to: "Migration20261003060000_ApplicationFreshness" });
    const org = await bootstrapDefaultLocalOrganization(createPersistenceRepositories(orm.em.fork()).organizations);
    // Upgrade the immediately previous schema with retained agents/tasks and identities.
    const registry = new DatabaseAgentRegistry({ orm, environmentUrls: () => [], legacyFilePath: join(directory, "absent") });
    const agent = await registry.add("https://fixture.example.test/card");
    const view = { localId: randomUUID() };
    await orm.em.getConnection().execute(
      "insert into tasks (id, organization_id, agent_id, tenant, remote_task_id, kind, state, created_at, updated_at) values (?, ?, ?, '', 'retained', 'task', 'TASK_STATE_WORKING', now(), now())",
      [view.localId, org.id, agent.id]);
    await orm.migrator.up();
    expect(await orm.migrator.checkSchema()).toBe(false);
    expect((await withTaskQueries((q) => q.detail(org.id, view.localId), orm))?.taskId).toBe("retained");
    const foreign = await createPersistenceRepositories(orm.em.fork()).organizations.getOrCreate({ id: randomUUID(), slug: "foreign",
      name: "Foreign", createdAt: new Date(), updatedAt: new Date() });
    const input = { issuer: "https://idp.example.test", subject: "subject", displayName: "Operator", organizationId: org.id, role: "admin" as const };
    const [admin, duplicate] = await Promise.all([provisionIdentity(orm.em.fork(), input), provisionIdentity(orm.em.fork(), input)]);
    expect(admin).toEqual(duplicate);
    expect(await orm.em.fork().count(UserEntity, {})).toBe(1);
    expect(await identities().resolveExternal(input.issuer, input.subject, "foreign")).toBeUndefined();
    expect(await identities().resolveExternal("https://other-idp.example.test", input.subject, "local")).toBeUndefined();
    expect(await identities().resolveExternal(input.issuer, "unknown", "local")).toBeUndefined();
    const outsider = await provisionIdentity(orm.em.fork(), { ...input, subject: "outside", organizationId: foreign.id, role: "operator" });
    const viewer = await provisionIdentity(orm.em.fork(), { ...input, subject: "viewer", role: "viewer" });
    const token = opaqueToken(); const expiry = new Date(Date.now() + 60_000);
    await identities().createSession(tokenHash(token), admin, expiry);
    expect(await identities().resolveSession(tokenHash(token), new Date())).toEqual(admin);
    expect(await identities().resolveSession(tokenHash(token), expiry)).toBeUndefined();
    expect(await identities().resolveSession(tokenHash(opaqueToken()), new Date())).toBeUndefined();
    expect((await orm.em.fork().findOneOrFail(UserSessionEntity, { tokenHash: tokenHash(token) })).tokenHash).not.toBe(token);
    const login = opaqueToken();
    const encrypted = await sealFlow({ state: "state", nonce: "nonce", verifier: "must-stay-private", returnTo: "/tasks" }, Buffer.alloc(32, 7));
    await identities().saveLogin(tokenHash(login), encrypted, expiry);
    expect(JSON.stringify(await orm.em.fork().find(LoginAttemptEntity, {}))).not.toContain("must-stay-private");
    const consumed = await Promise.all([identities().consumeLogin(tokenHash(login), new Date()), identities().consumeLogin(tokenHash(login), new Date())]);
    expect(consumed.filter(Boolean)).toEqual([encrypted]);
    await identities().saveLogin(tokenHash(login), encrypted, new Date(0));
    expect(await identities().consumeLogin(tokenHash(login), new Date())).toBeUndefined();
    const command = await withPrincipal(admin, () => acceptCommand(agent.id, { text: "Start" }, "one", { orm, store }));
    await withPrincipal(admin, () => acceptCommand(agent.id, { text: "Start" }, "one", { orm, store }));
    expect(await orm.em.fork().count(SecurityAuditEntity, { eventKey: `command:${command.id}` })).toBe(1);
    const audit = await orm.em.fork().findOneOrFail(SecurityAuditEntity, { eventKey: `command:${command.id}` });
    expect(audit.actorUserId).toBe(admin.userId); expect(audit.organizationId).toBe(org.id);
    expect(audit.action).toBe("task.send.accepted");
    await expect(withPrincipal(viewer, () => acceptCommand(agent.id, { text: "Forbidden" }, "denied", { orm, store }))).rejects.toMatchObject({ status: 403 });
    await expect(withPrincipal(outsider, () => acceptCommand(agent.id, { text: "Foreign" }, "foreign", { orm, store }))).rejects.toMatchObject({ status: 404 });
    expect(await withPrincipal(outsider, () => readCommand(command.id, orm))).toBeUndefined();
    expect(await withPrincipal(outsider, () => withTaskQueries((q, id) => q.detail(id, view.localId), orm))).toBeUndefined();
    expect(await withPrincipal(outsider, () => withTaskQueries((q, id) => q.contentPage(id), orm))).toEqual({ tasks: [], next: null });
    expect(await withPrincipal(outsider, () => registry.get(agent.id))).toBeUndefined();
    expect(await withPrincipal(outsider, () => registry.list())).toEqual([]);
    await expect(withPrincipal(outsider, () => registry.add("https://forbidden.example.test"))).rejects.toMatchObject({ status: 403 });
    const binary = await store.put(org.id, Buffer.from("private"));
    expect(await store.get(foreign.id, binary.digest)).toBeUndefined();
    // Audit failure/transaction rollback cannot leave accepted unaudited work.
    await expect(orm.em.fork().transactional(async (tx) => {
      await new DatabaseIdentityRepository(tx).appendAudit(admin, "test.rollback", agent.id);
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect(await orm.em.fork().count(SecurityAuditEntity, { action: "test.rollback" })).toBe(0);
    // Identity map refresh observes membership/user revocation immediately.
    const persistent = identities();
    expect(await persistent.resolveSession(tokenHash(token), new Date())).toEqual(admin);
    await orm.em.fork().nativeUpdate(MembershipEntity, { id: admin.membershipId }, { enabled: false });
    expect(await persistent.resolveSession(tokenHash(token), new Date())).toBeUndefined();
    await orm.em.fork().nativeUpdate(MembershipEntity, { id: admin.membershipId }, { enabled: true, role: "viewer" });
    expect((await persistent.resolveSession(tokenHash(token), new Date()))?.role).toBe("viewer");
    await orm.em.fork().nativeUpdate(UserEntity, { id: admin.userId }, { enabled: false });
    expect(await persistent.resolveSession(tokenHash(token), new Date())).toBeUndefined();
    await orm.em.fork().nativeUpdate(UserEntity, { id: admin.userId }, { enabled: true });
    await orm.close(true); orm = await createDatabaseOrm(config);
    expect((await identities().resolveSession(tokenHash(token), new Date()))?.role).toBe("viewer");
    await identities().revokeSession(tokenHash(token));
    expect(await identities().resolveSession(tokenHash(token), new Date())).toBeUndefined();
    // Read the retained previous-schema row without the newer ORM column mapping.
    await orm.migrator.down({ to: "Migration20261003060000_ApplicationFreshness" });
    expect(await orm.em.getConnection().execute("select remote_task_id from tasks where id = ?", [view.localId]))
      .toEqual([{ remote_task_id: "retained" }]);
    await orm.migrator.up();
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally { await orm.close(true); }
}
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-identity-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("SEC-001/004/AUD-001 PGlite identity", () => {
  it("verifies sessions, one-use login, membership roles, scoped runtime reads/writes, audit and migration/restart", async () => {
    await temporary((directory) => contract({ profile: "pglite", dataDir: join(directory, "db") }, directory));
  });
});
const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
if (process.env.CI === "true" && !postgresUrl) throw new Error("CI must set A2A_TEST_POSTGRES_URL");
if (postgresUrl && !decodeURIComponent(new URL(postgresUrl).pathname).includes("test")) throw new Error("A2A_TEST_POSTGRES_URL must target a test database");
(postgresUrl ? describe : describe.skip)("TST-001 PostgreSQL identity", () => {
  it("passes the same identity and security contract", async () => {
    await temporary((directory) => contract({ profile: "postgresql", url: postgresUrl! }, directory));
  });
});
