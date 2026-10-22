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
import { SecurityAuditEntity, SyncCursorEntity } from "./entities";
import { withPrincipal } from "../auth/principal-context";
import { agentSettingsSchema, changeAgentSettings, readDiscoveryStatus } from "../../runtime/agent-settings";

afterEach(() => { delete process.env.A2A_TASK_DISCOVERY; });

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
    const grant = (membershipId: string, skillId: string | null) => orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: membershipId, agentId: agent.id, skillId, permission: "operate" }));
    await grant(whole.membershipId, null); await grant(skillScoped.membershipId, "public"); await grant(viewer.membershipId, null);
    const stored = async () => (await createPersistenceRepositories(orm.em.fork()).agents.findById(org.id, agent.id))!;
    const status = (who: typeof admin) => withPrincipal(who, () => readDiscoveryStatus(who, agent.id, orm));
    const audited = async () => (await orm.em.fork().find(SecurityAuditEntity, { targetId: agent.id })).map((row) => row.action).filter((action) => action.startsWith("task.discovery")).sort();

    // The default: browse, nothing found yet, nothing known about listing.
    expect(await status(admin)).toEqual({ mode: "browse", effectiveMode: "browse", cap: "browse", historyDays: 7, pausedReason: null, listing: "unknown", auto: null, canBrowse: true });
    // Who may browse: whole-agent operators and administrators, not skill-scoped people or viewers.
    expect((await status(whole))!.canBrowse).toBe(true);
    expect((await status(skillScoped))!.canBrowse).toBe(false);
    expect((await status(viewer))!.canBrowse).toBe(false);
    expect(await readDiscoveryStatus(admin, randomUUID(), orm)).toBeUndefined();

    // Changing the mode is stored, audited once per real change, and shown.
    await changeAgentSettings(admin, agent.id, { taskDiscovery: "off" }, orm);
    expect((await stored()).taskDiscovery).toBe("off");
    expect(await status(admin)).toMatchObject({ mode: "off", effectiveMode: "off", canBrowse: false });
    await changeAgentSettings(admin, agent.id, { taskDiscovery: "off" }, orm);
    await changeAgentSettings(admin, agent.id, { taskDiscovery: "browse" }, orm);
    expect(await audited()).toEqual(["task.discovery.mode_changed.browse", "task.discovery.mode_changed.off"]);

    // History is stored on its own, without a mode change or an audit entry.
    await changeAgentSettings(admin, agent.id, { taskDiscoveryHistoryDays: 30 }, orm);
    expect((await status(admin))!.historyDays).toBe(30);
    expect(await audited()).toHaveLength(2);

    // The deployment cap lowers what applies and refuses a higher choice.
    process.env.A2A_TASK_DISCOVERY = "off";
    expect(await status(admin)).toMatchObject({ mode: "browse", effectiveMode: "off", cap: "off", canBrowse: false });
    await expect(changeAgentSettings(admin, agent.id, { taskDiscovery: "browse" }, orm)).rejects.toMatchObject({ status: 409, kind: "discovery_capped" });
    await changeAgentSettings(admin, agent.id, { taskDiscovery: "off" }, orm);
    delete process.env.A2A_TASK_DISCOVERY;
    // By default the deployment does not allow automatic discovery at all; once it does, switching it on gives the worker cursors to claim.
    await expect(changeAgentSettings(admin, agent.id, { taskDiscovery: "auto" }, orm)).rejects.toMatchObject({ status: 409, kind: "discovery_capped" });
    process.env.A2A_TASK_DISCOVERY = "auto";
    await changeAgentSettings(admin, agent.id, { taskDiscovery: "auto" }, orm);
    expect((await status(admin))!).toMatchObject({ mode: "auto", effectiveMode: "auto", auto: { lastCheckedAt: null, foundTotal: 0 } });
    expect((await orm.em.fork().find(SyncCursorEntity, { agentId: agent.id, resourceKey: "" })).map((cursor) => cursor.tenant)).toEqual([""]);
    delete process.env.A2A_TASK_DISCOVERY;
    await changeAgentSettings(admin, agent.id, { taskDiscovery: "browse" }, orm);
    // A nickname tells apart registrations whose cards share a name: trimmed, unique ignoring case, clearable, audited, and shown by the catalog.
    const second = await registry.add("https://agent.test/other-card", "  Support   (ADK) ");
    expect(second.nickname).toBe("Support (ADK)");
    await changeAgentSettings(admin, agent.id, { nickname: "Support (LangGraph)" }, orm);
    expect((await stored()).nickname).toBe("Support (LangGraph)");
    expect((await registry.list()).map((item) => item.nickname).sort()).toEqual(["Support (ADK)", "Support (LangGraph)"]);
    await expect(changeAgentSettings(admin, agent.id, { nickname: "support (adk)" }, orm)).rejects.toMatchObject({ status: 409, kind: "nickname_taken" });
    await expect(registry.add("https://agent.test/third-card", "SUPPORT (ADK)")).rejects.toThrow(/already called/);
    await expect(changeAgentSettings(admin, agent.id, { nickname: "x".repeat(101) }, orm)).rejects.toThrow();
    await expect(changeAgentSettings(admin, agent.id, { nickname: "bad\u0007name" }, orm)).rejects.toMatchObject({ status: 400 });
    await changeAgentSettings(admin, agent.id, { nickname: "  " }, orm);
    expect((await stored()).nickname).toBeNull();
    // A removed agent frees its nickname.
    await registry.remove(second.id);
    await changeAgentSettings(admin, agent.id, { nickname: "Support (ADK)" }, orm);
    expect((await stored()).nickname).toBe("Support (ADK)");
    expect((await orm.em.fork().find(SecurityAuditEntity, { targetId: agent.id })).map((row) => row.action).filter((action) => action.startsWith("agent.nickname")).sort())
      .toEqual(["agent.nickname.cleared", "agent.nickname.set", "agent.nickname.set"]);
    await changeAgentSettings(admin, agent.id, { nickname: null }, orm);
    // Another organization's agent is unknown.
    await expect(changeAgentSettings({ ...admin, organizationId: randomUUID() }, agent.id, { taskDiscovery: "off" }, orm)).rejects.toMatchObject({ status: 404 });

    // An agent that cannot list tasks is remembered from its list cursor.
    await orm.em.fork().nativeUpdate(SyncCursorEntity, { organizationId: org.id, agentId: agent.id, resourceKey: "" }, { status: "unsupported" });
    expect((await status(admin))!.listing).toBe("unsupported");
  } finally { await orm.close(true); }
}
async function temporary(config: (directory: string) => DatabaseConfig) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-agent-settings-"));
  try { await contract(config(directory), directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("agent settings and discovery status (PGlite)", () => {
  it("stores the mode with its rules and reports who may browse", () => temporary((dir) => ({ profile: "pglite", dataDir: join(dir, "db") })));
});
const url = process.env.A2A_TEST_POSTGRES_URL;
if (url && !decodeURIComponent(new URL(url).pathname).includes("test")) throw new Error("Use a test database");
(url ? describe : describe.skip)("agent settings and discovery status (PostgreSQL)", () => {
  it("passes the same contract", () => temporary(() => ({ profile: "postgresql", url: url! })));
});

describe("agentSettingsSchema", () => {
  it("accepts the supported settings and refuses anything else", () => {
    expect(agentSettingsSchema.safeParse({ taskDiscovery: "browse", taskDiscoveryHistoryDays: 90 }).success).toBe(true);
    expect(agentSettingsSchema.safeParse({ nickname: null }).success).toBe(true);
    for (const body of [{}, { taskDiscovery: "on" }, { taskDiscoveryHistoryDays: -1 }, { taskDiscoveryHistoryDays: 91 }, { taskDiscoveryHistoryDays: 1.5 }, { surprise: true }, { taskDiscovery: "off", extra: 1 }])
      expect(agentSettingsSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
  });
});
