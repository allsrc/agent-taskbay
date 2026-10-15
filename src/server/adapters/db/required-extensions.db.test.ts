import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabaseOrm } from "./orm";
import type { DatabaseConfig } from "./config";
import { createPersistenceRepositories } from "./repositories";
import { DatabaseAgentRegistry } from "./agent-registry";
import { createTaskObserver } from "../../runtime/task-persistence";
import { acceptCommand } from "../../runtime/commands";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { TaskCommandEntity } from "./entities";
import { A2UI_EXTENSION_URI } from "../../../lib/a2ui";
import { provisionIdentity } from "./identity-repository";
import { changeAgentSettings } from "../../runtime/agent-settings";
import { SecurityAuditEntity } from "./entities";

const needed = "https://example.test/extensions/needed/v1";
// A card that requires an extension Taskbay cannot honor blocks sends, but never cancels, until an administrator allows it.
async function contract(config: DatabaseConfig, directory: string) {
  const orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const registry = new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    const agent = await registry.add("https://agent.test/card");
    const record = (extensions: Array<{ uri: string; required: boolean }>) => registry.recordDiscovery(agent.id, { resolvedCardUrl: agent.cardUrl, rawCardJson: {},
      normalizedCardJson: { capabilities: { extensions } }, complianceJson: {}, signatureStatus: "unsigned", digest: randomUUID().replaceAll("-", "").padEnd(64, "0"),
      displayName: null, description: null, protocolSnapshotVersion: null });
    const org = (await createPersistenceRepositories(orm.em.fork()).organizations.findBySlug("local"))!;
    const store = new FilesystemArtifactStore(join(directory, "artifacts"));
    await createTaskObserver({ organizationId: org.id, agentId: agent.id, sessionId: randomUUID(), requestId: randomUUID() }, { orm, store, manageSubscription: false, managePush: false })(
      { task: { id: "open", contextId: "c", status: { state: "TASK_STATE_WORKING" } } });
    const commands = () => orm.em.fork().count(TaskCommandEntity, {});
    const override = (value: boolean) => orm.em.fork().transactional((em) => createPersistenceRepositories(em).agents.setExtensionOverride(org.id, agent.id, value, new Date()));
    let key = 0;
    const send = (body: Record<string, unknown> = { text: "hello" }) => acceptCommand(agent.id, body, `key-${key++}`, { orm, store });

    // No requirement, an optional one, and a required one Taskbay understands: all allowed.
    await record([]); await expect(send()).resolves.toMatchObject({ action: "send" });
    await record([{ uri: needed, required: false }]); await expect(send()).resolves.toMatchObject({ action: "send" });
    await record([{ uri: A2UI_EXTENSION_URI, required: true }]); await expect(send()).resolves.toMatchObject({ action: "send" });

    // A required extension Taskbay does not support blocks sends, before anything is saved, and says which one.
    await record([{ uri: needed, required: true }]);
    const before = await commands();
    await expect(send()).rejects.toMatchObject({ status: 409, kind: "extension_required", details: { extensions: [needed] } });
    expect(await commands()).toBe(before);
    // Cancel is not a send: it works either way.
    await expect(send({ action: "cancelTask", taskId: "open" })).resolves.toMatchObject({ action: "cancelTask" });

    // The administrator override allows sending, and removing it blocks again.
    expect(await override(true)).toBe(true);
    await expect(send()).resolves.toMatchObject({ action: "send" });
    await override(false);
    await expect(send()).rejects.toMatchObject({ kind: "extension_required" });

    // The newest card decides: once the agent drops the requirement, sending works again.
    await record([]);
    await expect(send()).resolves.toMatchObject({ action: "send" });
    expect(await override(true) && (await createPersistenceRepositories(orm.em.fork()).agents.findById(org.id, agent.id))!.extensionOverride).toBe(true);
    // Changing the setting through the runtime records who did it, and refuses an agent of another organization.
    const admin = await provisionIdentity(orm.em.fork(), { issuer: "https://idp.test", subject: "admin", organizationId: org.id, displayName: "Admin", role: "admin" });
    await changeAgentSettings(admin, agent.id, { extensionOverride: false }, orm);
    await changeAgentSettings(admin, agent.id, { extensionOverride: true }, orm);
    expect((await orm.em.fork().find(SecurityAuditEntity, { actorUserId: admin.userId })).map((row) => row.action).filter((action) => action.startsWith("agent.extension")).sort())
      .toEqual(["agent.extension.override", "agent.extension.override.removed"]);
    expect((await orm.em.fork().find(SecurityAuditEntity, { action: "agent.extension.override" }))[0]).toMatchObject({ targetId: agent.id, organizationId: org.id });
    await expect(changeAgentSettings({ ...admin, organizationId: randomUUID() }, agent.id, { extensionOverride: true }, orm)).rejects.toMatchObject({ status: 404 });
    // The override belongs to one organization.
    expect(await createPersistenceRepositories(orm.em.fork()).agents.setExtensionOverride(randomUUID(), agent.id, false, new Date())).toBe(false);
  } finally { await orm.close(true); }
}
async function temporary(config: (directory: string) => DatabaseConfig) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-required-ext-"));
  try { await contract(config(directory), directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("required extensions (PGlite)", () => {
  it("blocks sends to an agent that requires an unsupported extension until an administrator allows it", () => temporary((dir) => ({ profile: "pglite", dataDir: join(dir, "db") })));
});
const url = process.env.A2A_TEST_POSTGRES_URL;
if (url && !decodeURIComponent(new URL(url).pathname).includes("test")) throw new Error("Use a test database");
(url ? describe : describe.skip)("required extensions (PostgreSQL)", () => {
  it("passes the same contract", () => temporary(() => ({ profile: "postgresql", url: url! })));
});
