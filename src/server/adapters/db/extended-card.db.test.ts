import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DatabaseConfig } from "./config";
import { createDatabaseOrm } from "./orm";
import { createPersistenceRepositories } from "./repositories";
import { DatabaseAgentRegistry } from "./agent-registry";
import { provisionIdentity } from "./identity-repository";
import { createGrant } from "./security-repository";
import { AgentCardSnapshotEntity } from "./entities";
import { withPrincipal } from "../auth/principal-context";
import { FetchExtendedCardService } from "../../application/services/fetch-extended-card";
import { SKILL_ROUTING_EXTENSION } from "../../application/services/access-policy";
import { readExtendedCard } from "../../runtime/extended-card";
import { acceptCommand } from "../../runtime/commands";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import type { JsonValue } from "../../domain/persistence-model";

async function contract(config: DatabaseConfig, directory: string) {
  let orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up({ to: "Migration0006_TaskContextIndex" });
    const sql = orm.em.getConnection();
    const organizationId = randomUUID(), agentId = randomUUID(), oldId = randomUUID();
    await sql.execute("insert into organizations (id, slug, name, created_at, updated_at) values (?, 'local', 'Local', now(), now())", [organizationId]);
    await sql.execute("insert into agents (id, organization_id, card_url, source, enabled, created_at, updated_at) values (?, ?, 'https://agent.test/card.json', 'managed', true, now(), now())", [agentId, organizationId]);
    await sql.execute("insert into agent_card_snapshots (id, agent_id, fetched_at, raw_card_json, normalized_card_json, compliance_json, signature_status, digest) values (?, ?, now(), '{}', '{}', '{}', 'unsigned', 'old')", [oldId, agentId]);
    await orm.migrator.up();
    expect(await orm.em.fork().findOne(AgentCardSnapshotEntity, { id: oldId })).toMatchObject({ kind: "public" });
    expect(await orm.migrator.checkSchema()).toBe(false);
    const registry = () => new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    const repos = () => createPersistenceRepositories(orm.em.fork());
    await registry().recordDiscovery(agentId, { resolvedCardUrl: "https://agent.test/card.json", rawCardJson: {},
      normalizedCardJson: { skills: [{ id: "work", name: "Public" }], capabilities: { extendedAgentCard: true, extensions: [{ uri: SKILL_ROUTING_EXTENSION }] } },
      complianceJson: {}, digest: "public", displayName: "Public agent", description: "Public", protocolSnapshotVersion: "1" });
    const publicBefore = await repos().agents.findLatestCardSnapshot(agentId);
    const admin = await provisionIdentity(orm.em.fork(), { issuer: "idp", subject: "admin", organizationId, displayName: "Admin", role: "admin" });
    const member = await provisionIdentity(orm.em.fork(), { issuer: "idp", subject: "member", organizationId, displayName: "Member", role: "operator" });
    const other = await repos().organizations.getOrCreate({ id: randomUUID(), slug: "other", name: "Other", createdAt: new Date(), updatedAt: new Date() });
    const otherAdmin = await provisionIdentity(orm.em.fork(), { issuer: "idp", subject: "other", organizationId: other.id, displayName: "Other", role: "admin" });
    let calls = 0;
    const extra: JsonValue = { skills: [{ id: "private", name: "Extra" }], capabilities: { streaming: false, extensions: [{ uri: "urn:unsupported", required: true }] }, secretMetadata: "not in display" };
    const service = () => new FetchExtendedCardService(repos().agents, { fetch: async () => { calls++; return { card: extra, signatureStatus: "unsigned" }; } });
    await expect(service().fetch(other.id, agentId)).rejects.toMatchObject({ status: 404 });
    expect(calls).toBe(0);
    await service().fetch(organizationId, agentId);
    expect(await repos().agents.findLatestCardSnapshot(agentId)).toEqual(publicBefore);
    expect(await repos().agents.findLatestExtendedCardSnapshot(organizationId, agentId)).toMatchObject({ kind: "extended", normalizedCardJson: extra });
    expect(await repos().agents.findLatestExtendedCardSnapshot(other.id, agentId)).toBeUndefined();
    expect((await repos().agents.findById(organizationId, agentId))?.displayName).toBe("Public agent");
    expect(await withPrincipal(otherAdmin, () => readExtendedCard(agentId, orm))).toBeUndefined();
    expect(await withPrincipal(member, () => readExtendedCard(agentId, orm))).toBeUndefined();
    const visible = await withPrincipal(admin, () => readExtendedCard(agentId, orm));
    expect(visible?.skills.map((skill) => skill.id)).toEqual(["private"]);
    expect(JSON.stringify(visible)).not.toContain("secretMetadata");
    await orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: member.membershipId, agentId, skillId: "work", permission: "operate" }));
    expect(await withPrincipal(member, () => readExtendedCard(agentId, orm))).toBeUndefined();
    await expect(orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: member.membershipId, agentId, skillId: "private", permission: "operate" }))).rejects.toThrow("public Agent Card");
    const store = new FilesystemArtifactStore(join(directory, "objects"));
    // The extended required extension cannot block public routing, and it cannot authorize an extra skill.
    expect(await withPrincipal(member, () => acceptCommand(agentId, { text: "Public", skillId: "work" }, "public-send", { orm, store }))).toMatchObject({ status: "pending" });
    await expect(withPrincipal(admin, () => acceptCommand(agentId, { text: "Extra", skillId: "private" }, "extra-send", { orm, store }))).rejects.toMatchObject({ status: 403 });
    await orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: member.membershipId, agentId, skillId: null, permission: "read" }));
    expect(await withPrincipal(member, () => readExtendedCard(agentId, orm))).toEqual(visible);
    // Fetching before the first public discovery cannot make an extended skill grantable.
    const unpublished = await registry().add("https://agent.test/unpublished.json");
    await service().fetch(organizationId, unpublished.id);
    await expect(orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: member.membershipId,
      agentId: unpublished.id, skillId: "private", permission: "operate" }))).rejects.toThrow("public Agent Card");
    const count = await orm.em.fork().count(AgentCardSnapshotEntity, {});
    expect(await new FetchExtendedCardService(repos().agents, { fetch: async () => undefined }).fetch(organizationId, agentId)).toBeUndefined();
    await expect(new FetchExtendedCardService(repos().agents, { fetch: async () => { throw new Error("unsafe"); } }).fetch(organizationId, agentId)).rejects.toThrow("unsafe");
    expect(await orm.em.fork().count(AgentCardSnapshotEntity, {})).toBe(count);
    await orm.close(true); orm = await createDatabaseOrm(config);
    expect(await repos().agents.findLatestCardSnapshot(agentId)).toEqual(publicBefore);
    expect(await repos().agents.findLatestExtendedCardSnapshot(organizationId, agentId)).toMatchObject({ kind: "extended" });
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally { await orm.close(true); }
}
async function temporary(config: (directory: string) => DatabaseConfig) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-extended-card-"));
  try { await contract(config(directory), directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("extended cards (PGlite)", () => {
  it("upgrades public snapshots and isolates extended cards, grants, routing and organizations", () => temporary((dir) => ({ profile: "pglite", dataDir: join(dir, "db") })));
});
const url = process.env.A2A_TEST_POSTGRES_URL;
if (url && !decodeURIComponent(new URL(url).pathname).includes("test")) throw new Error("Use a test database");
(url ? describe : describe.skip)("extended cards (PostgreSQL)", () => {
  it("passes the same upgrade and isolation contract", () => temporary(() => ({ profile: "postgresql", url: url! })));
});
