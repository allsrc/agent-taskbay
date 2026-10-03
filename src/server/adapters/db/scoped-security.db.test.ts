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
import { createGrant, DatabaseAccessPolicyRepository, takeRateLimit } from "./security-repository";
import { EncryptedDatabaseCredentialVault } from "./credential-vault";
import { AccessGrantEntity, AgentCredentialEntity, ArtifactAccessEntity, SecurityAuditEntity, TeamEntity, TeamMembershipEntity } from "./entities";
import { withPrincipal } from "../auth/principal-context";
import { createTaskObserver, withTaskQueries } from "../../runtime/task-persistence";
import { acceptCommand, readCommand } from "../../runtime/commands";
import { authorizedArtifact } from "../../runtime/security";
import { createProjectionRebuilder } from "../../runtime/projection-rebuild";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { AccessPolicy, SKILL_ROUTING_EXTENSION } from "../../application/services/access-policy";

async function contract(config: DatabaseConfig, directory: string) {
  let orm = await createDatabaseOrm(config);
  const previousKeys = process.env.A2A_VAULT_KEYS, previousActive = process.env.A2A_VAULT_ACTIVE_KEY;
  process.env.A2A_VAULT_KEYS = JSON.stringify({old: "ab".repeat(32), current: "cd".repeat(32)}); process.env.A2A_VAULT_ACTIVE_KEY = "old";
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({to: 0});
    await orm.migrator.up({to: "Migration20261003080625_IdentitySessions"});
    await orm.migrator.up();
    const registry = new DatabaseAgentRegistry({orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => []});
    const agent = await registry.add("https://agent.test/card");
    const ports = createPersistenceRepositories(orm.em.fork());
    const org = (await ports.organizations.findBySlug("local"))!;
    const admin = await provisionIdentity(orm.em.fork(), {issuer: "https://idp.test", subject: "admin", organizationId: org.id, displayName: "Admin", role: "admin"});
    const member = await provisionIdentity(orm.em.fork(), {issuer: "https://idp.test", subject: "operator", organizationId: org.id, displayName: "Operator", role: "operator"});
    expect(await withPrincipal(member, () => registry.get(agent.id))).toBeUndefined();
    expect(await withPrincipal(member, () => registry.list())).toEqual([]);
    await expect(withPrincipal(member, () => acceptCommand(agent.id, {text: "denied"}, "denied", {orm}))).rejects.toMatchObject({status: 403});
    const teamId = randomUUID();
    await orm.em.fork().insert(TeamEntity, {id: teamId, organizationId: org.id, name: "Operations", enabled: true});
    await orm.em.fork().insert(TeamMembershipEntity, {id: randomUUID(), teamId, membershipId: member.membershipId});
    const grant = await orm.em.fork().transactional((tx) => createGrant(tx, admin, {subjectType: "team", subjectId: teamId, agentId: agent.id, skillId: "public", permission: "operate"}));
    expect(await withPrincipal(member, () => registry.get(agent.id))).toMatchObject({id: agent.id});
    await registry.recordDiscovery(agent.id, {resolvedCardUrl: agent.cardUrl, rawCardJson: {}, normalizedCardJson: {skills: [{id: "public"}, {id: "private"}], capabilities: {extensions: [{uri: SKILL_ROUTING_EXTENSION}]}}, complianceJson: {}, digest: "fixture", displayName: "Agent", description: null, protocolSnapshotVersion: "1"});
    const store = new FilesystemArtifactStore(join(directory, "artifacts"));
    const observe = (skillId: string) => createTaskObserver({organizationId: org.id, agentId: agent.id, skillId, sessionId: randomUUID(), requestId: randomUUID()}, {orm, store, manageSubscription: false, managePush: false});
    const publicTask = await observe("public")({task: {id: "public-task", status: {state: "TASK_STATE_COMPLETED"}, artifacts: [{artifactId: "file", parts: [{raw: "cHVibGlj"}]}]}});
    const hiddenTask = await observe("private")({task: {id: "private-task", status: {state: "TASK_STATE_COMPLETED"}, artifacts: [{artifactId: "file", parts: [{raw: "cHJpdmF0ZQ=="}]}]}});
    const publicDigest = (await store.put(org.id, Buffer.from("public"))).digest;
    const privateDigest = (await store.put(org.id, Buffer.from("private"))).digest;
    expect(await withPrincipal(member, () => withTaskQueries((q, id) => q.detail(id, hiddenTask.localId), orm))).toBeUndefined();
    expect((await withPrincipal(member, () => withTaskQueries((q, id) => q.contentPage(id, 1), orm))).tasks.map((task) => task.localId)).toEqual([publicTask.localId]);
    expect(await withPrincipal(member, () => authorizedArtifact(org.id, publicDigest, orm))).toBe(true);
    expect(await withPrincipal(member, () => authorizedArtifact(org.id, privateDigest, orm))).toBe(false);
    // Forged local URLs/metadata do not grant access to stored bytes.
    await observe("public")({task: {id: "forged", status: {state: "TASK_STATE_COMPLETED"}, artifacts: [{artifactId: "forged", parts: [{url: `/api/artifacts/${privateDigest}`, metadata: {a2aOpsObject: {digest: privateDigest}}}]}]}});
    expect(await withPrincipal(member, () => authorizedArtifact(org.id, privateDigest, orm))).toBe(false);
    await expect(withPrincipal(member, () => acceptCommand(agent.id, {text: "generic"}, "generic", {orm, store}))).rejects.toMatchObject({status: 403});
    await expect(withPrincipal(member, () => acceptCommand(agent.id, {text: "bad", skillId: "private"}, "private", {orm, store}))).rejects.toMatchObject({status: 403});
    await expect(withPrincipal(member, () => acceptCommand(agent.id, {text: "bad", skillId: "public", contextId: "private-context"}, "context", {orm, store}))).rejects.toMatchObject({status: 403});
    await expect(withPrincipal(member, () => acceptCommand(agent.id, {text: "bad", skillId: "public", config: {referenceTaskIds: ["private-task"]}}, "reference", {orm, store}))).rejects.toMatchObject({status: 404});
    const command = await withPrincipal(member, () => acceptCommand(agent.id, {text: "allowed", skillId: "public", config: {requestMetadata: {[SKILL_ROUTING_EXTENSION]: {skillId: "private"}}}}, "public-command", {orm, store}));
    const params = JSON.parse(Buffer.from((await store.get(org.id, command.payloadObjectKey.split("/")[1]))!).toString());
    expect(params.requestMetadata[SKILL_ROUTING_EXTENSION]).toEqual({skillId: "public"});
    const vault = () => new EncryptedDatabaseCredentialVault(orm.em.fork());
    const binding = {origins: ["https://agent.test"], credential: {type: "bearer" as const, token: "server-only-secret-123"}};
    await vault().store(org.id, agent.id, binding);
    expect(await vault().resolve(org.id, agent.id)).toEqual(binding);
    expect(await vault().resolve(randomUUID(), agent.id)).toBeUndefined();
    const row = await orm.em.fork().findOneOrFail(AgentCredentialEntity, {agentId: agent.id});
    expect(JSON.stringify(row)).not.toContain(binding.credential.token);
    await orm.em.fork().nativeUpdate(AgentCredentialEntity, {id: row.id}, {ciphertext: row.ciphertext.slice(0, -4) + "AAAA"});
    await expect(vault().resolve(org.id, agent.id)).rejects.toThrow("unavailable");
    await vault().store(org.id, agent.id, binding);
    process.env.A2A_VAULT_KEYS = JSON.stringify({old: "ef".repeat(32), current: "cd".repeat(32)});
    await expect(vault().resolve(org.id, agent.id)).rejects.toThrow("unavailable");
    process.env.A2A_VAULT_KEYS = JSON.stringify({old: "ab".repeat(32), current: "cd".repeat(32)});
    const otherAgent = await registry.add("https://other-agent.test/card");
    await vault().store(org.id, otherAgent.id, binding);
    const sourceCipher = (await orm.em.fork().findOneOrFail(AgentCredentialEntity, {agentId: agent.id})).ciphertext;
    await orm.em.fork().nativeUpdate(AgentCredentialEntity, {agentId: otherAgent.id}, {ciphertext: sourceCipher});
    await expect(vault().resolve(org.id, otherAgent.id)).rejects.toThrow("unavailable");
    process.env.A2A_VAULT_ACTIVE_KEY = "current";
    await vault().store(org.id, agent.id, (await vault().resolve(org.id, agent.id))!);
    expect((await orm.em.fork().findOneOrFail(AgentCredentialEntity, {agentId: agent.id})).keyId).toBe("current");
    expect(JSON.stringify(await orm.em.fork().find(SecurityAuditEntity, {}))).not.toContain(binding.credential.token);
    await takeRateLimit(orm.em.fork(), "contract", 1);
    await expect(takeRateLimit(orm.em.fork(), "contract", 1)).rejects.toMatchObject({status: 429});
    await takeRateLimit(orm.em.fork(), "contract", 1, new Date(Date.now() + 61_000));
    // Previous archives can reconstruct reference permissions after upgrade.
    await orm.em.fork().nativeDelete(ArtifactAccessEntity, {});
    await createProjectionRebuilder({orm, store}).rebuild(org.id, publicTask.localId);
    expect(await withPrincipal(member, () => authorizedArtifact(org.id, publicDigest, orm))).toBe(true);
    await orm.close(true); orm = await createDatabaseOrm(config);
    expect(await vault().resolve(org.id, agent.id)).toEqual(binding);
    expect(new AccessPolicy(member, await new DatabaseAccessPolicyRepository(orm.em.fork()).grantsFor(member)).allows(agent.id, "operate", "public")).toBe(true);
    await vault().revoke(org.id, agent.id);
    await expect(vault().resolve(org.id, agent.id)).rejects.toThrow("disabled");
    await orm.em.fork().nativeUpdate(TeamEntity, {id: teamId}, {enabled: false});
    expect(await withPrincipal(member, () => registry.get(agent.id))).toBeUndefined();
    expect(await withPrincipal(member, () => readCommand(command.id, orm))).toBeUndefined();
    await orm.em.fork().nativeUpdate(AccessGrantEntity, {id: grant.id}, {enabled: false});
    await orm.migrator.down({to: "Migration20261003080625_IdentitySessions"});
    expect(await orm.em.getConnection().execute("select remote_task_id from tasks where id = ?", [publicTask.localId])).toEqual([{remote_task_id: "public-task"}]);
    await orm.migrator.up(); expect(await orm.migrator.checkSchema()).toBe(false);
  } finally {
    if (previousKeys === undefined) delete process.env.A2A_VAULT_KEYS; else process.env.A2A_VAULT_KEYS = previousKeys;
    if (previousActive === undefined) delete process.env.A2A_VAULT_ACTIVE_KEY; else process.env.A2A_VAULT_ACTIVE_KEY = previousActive;
    await orm.close(true);
  }
}
async function temporary(config: (directory: string) => DatabaseConfig) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-security-"));
  try { await contract(config(directory), directory); } finally { await rm(directory, {recursive: true, force: true}); }
}
describe("SEC-002..005 PGlite security", () => { it("verifies grants, skill/task/artifact isolation, vault rotation/revoke, rate limits and restart/upgrade/rollback", () => temporary((dir) => ({profile: "pglite", dataDir: join(dir, "db")}))); });
const url = process.env.A2A_TEST_POSTGRES_URL;
if (url && !decodeURIComponent(new URL(url).pathname).includes("test")) throw new Error("Use a test database");
(url ? describe : describe.skip)("SEC-002..005 PostgreSQL security", () => { it("passes the same scoped security contract", () => temporary(() => ({profile: "postgresql", url: url!}))); });
