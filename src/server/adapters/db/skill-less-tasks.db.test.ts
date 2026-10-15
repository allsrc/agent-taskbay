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
import { acceptCommand } from "../../runtime/commands";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { SKILL_ROUTING_EXTENSION } from "../../application/services/access-policy";

// A task with no skill (one started outside Taskbay, or sent without skill routing) must be visible to administrators and
// whole-agent grants only, and must never become reachable through a skill-scoped grant.
async function contract(config: DatabaseConfig, directory: string) {
  const orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const registry = new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    const agent = await registry.add("https://agent.test/card");
    await registry.recordDiscovery(agent.id, { resolvedCardUrl: agent.cardUrl, rawCardJson: {}, normalizedCardJson: { skills: [{ id: "public" }],
      capabilities: { extensions: [{ uri: SKILL_ROUTING_EXTENSION }] } }, complianceJson: {}, signatureStatus: "unsigned", digest: "a".repeat(64) } as never);
    const org = (await createPersistenceRepositories(orm.em.fork()).organizations.findBySlug("local"))!;
    const person = (subject: string, role: "admin" | "operator") =>
      provisionIdentity(orm.em.fork(), { issuer: "https://idp.test", subject, organizationId: org.id, displayName: subject, role });
    const admin = await person("admin", "admin");
    const wholeAgent = await person("whole", "operator");
    const skillScoped = await person("skill", "operator");
    const nobody = await person("nobody", "operator");
    const grant = (membershipId: string, skillId: string | null) => orm.em.fork().transactional((tx) =>
      createGrant(tx, admin, { subjectType: "membership", subjectId: membershipId, agentId: agent.id, skillId, permission: "operate" }));
    await grant(wholeAgent.membershipId, null);
    await grant(skillScoped.membershipId, "public");

    const store = new FilesystemArtifactStore(join(directory, "artifacts"));
    const observe = (skillId?: string) => createTaskObserver({ organizationId: org.id, agentId: agent.id, ...(skillId ? { skillId } : {}), sessionId: randomUUID(), requestId: randomUUID() },
      { orm, store, manageSubscription: false, managePush: false });
    const noSkill = await observe()({ task: { id: "no-skill", contextId: "ctx", status: { state: "TASK_STATE_INPUT_REQUIRED" } } });
    const withSkill = await observe("public")({ task: { id: "with-skill", contextId: "ctx-public", status: { state: "TASK_STATE_WORKING" } } });

    const sees = async (who: typeof admin, localId: string) => Boolean(await withPrincipal(who, () => withTaskQueries((q, id) => q.detail(id, localId), orm)));
    const listed = async (who: typeof admin) => (await withPrincipal(who, () => withTaskQueries((q, id) => q.contentPage(id, 50), orm))).tasks.map((task) => task.localId).sort();

    // Q3: who can see a task whose skill is null.
    expect(await sees(admin, noSkill.localId)).toBe(true);
    expect(await sees(wholeAgent, noSkill.localId)).toBe(true);
    expect(await sees(skillScoped, noSkill.localId)).toBe(false);
    expect(await sees(nobody, noSkill.localId)).toBe(false);
    expect(await listed(wholeAgent)).toEqual([noSkill.localId, withSkill.localId].sort());
    expect(await listed(skillScoped)).toEqual([withSkill.localId]);
    expect(await listed(nobody)).toEqual([]);

    // Q4: sending to an existing skill-less task.
    const send = (who: typeof admin, body: Record<string, unknown>, key: string) => withPrincipal(who, () => acceptCommand(agent.id, { text: "more", taskId: "no-skill", ...body }, key, { orm, store }));
    await expect(send(wholeAgent, {}, "whole-ok")).resolves.toMatchObject({ skillId: null, status: "pending" });
    // A client that names a skill for a skill-less task is refused, which is why the chat must not pass a picker skill for one.
    await expect(send(wholeAgent, { skillId: "public" }, "whole-skill")).rejects.toMatchObject({ status: 403 });
    // Neither a skill-scoped person nor someone with no grant can reach it; both are told it does not exist.
    await expect(send(skillScoped, {}, "skill-none")).rejects.toMatchObject({ status: 404 });
    await expect(send(skillScoped, { skillId: "public" }, "skill-named")).rejects.toMatchObject({ status: 404 });
    await expect(send(nobody, {}, "nobody")).rejects.toMatchObject({ status: 404 });
  } finally { await orm.close(true); }
}
async function temporary(config: (directory: string) => DatabaseConfig) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-skillless-"));
  try { return await contract(config(directory), directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("tasks without a skill (PGlite)", () => {
  it("are visible to administrators and whole-agent grants only", async () => {
    await temporary((dir) => ({ profile: "pglite", dataDir: join(dir, "db") }));
  });
});
const url = process.env.A2A_TEST_POSTGRES_URL;
if (url && !decodeURIComponent(new URL(url).pathname).includes("test")) throw new Error("Use a test database");
(url ? describe : describe.skip)("tasks without a skill (PostgreSQL)", () => {
  it("are visible to administrators and whole-agent grants only", async () => { await temporary(() => ({ profile: "postgresql", url: url! })); });
});
