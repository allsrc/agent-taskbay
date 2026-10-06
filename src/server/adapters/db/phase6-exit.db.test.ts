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
import { DecisionEntity, DecisionRequestEntity, TaskCommandEntity } from "./entities";
import { withPrincipal } from "../auth/principal-context";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { bootstrapDefaultLocalOrganization } from "../../application/services/bootstrap-default-organization";
import { DecisionService } from "../../application/services/decisions";
import { acceptCommand } from "../../runtime/commands";
import { decisionUnitOfWork, readDecision } from "../../runtime/decisions";
import { openAgentApprovalIfRequested } from "../../runtime/agent-approvals";
import { APPROVAL_REQUEST_EXTENSION_URI, APPROVAL_REQUEST_MEDIA_TYPE } from "../../application/services/agent-approval";
import { SKILL_ROUTING_EXTENSION } from "../../application/services/access-policy";
import type { DurableTaskView } from "../../../shared/task-types";

/**
 * Phase 6 exit criterion: "Generated UI cannot ... bypass authorization." Forms, A2UI actions, AG-UI resumes and approval metadata
 * are ordinary parts of the same command and decision paths, so they inherit those checks; this proves it for each Phase 6 payload.
 */
const PAYLOADS: Array<[string, Record<string, unknown>]> = [
  ["a form submission", { parts: [{ data: { environment: "production", replicas: 3 }, mediaType: "application/json" }] }],
  ["an A2UI action", { parts: [{ data: { version: "v0.9", action: { name: "confirm_deploy", surfaceId: "s", sourceComponentId: "b", timestamp: "2026-10-06T00:00:00Z", context: {} } }, mediaType: "application/a2ui+json" }],
    config: { extensions: ["https://a2ui.org/a2a-extension/a2ui/v0.9"], metadata: { a2uiClientCapabilities: { "v0.9": { supportedCatalogIds: ["x"] } } } } }],
  ["a message claiming an approval", { text: "approved", config: { metadata: { approval: { requestId: randomUUID(), decisionId: randomUUID(), revision: 1, revisionDigest: "a".repeat(64) } } } }],
];

async function contract(config: DatabaseConfig, directory: string) {
  const orm = await createDatabaseOrm(config);
  const store = new FilesystemArtifactStore(join(directory, "artifacts"));
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const org = await bootstrapDefaultLocalOrganization(createPersistenceRepositories(orm.em.fork()).organizations);
    const registry = new DatabaseAgentRegistry({ orm, environmentUrls: () => [], legacyFilePath: join(directory, "absent") });
    const agent = await registry.add("https://fixture.example.test/card");
    await registry.recordDiscovery(agent.id, { resolvedCardUrl: agent.cardUrl, rawCardJson: {}, complianceJson: {}, digest: "d".repeat(64), signatureStatus: "unsigned",
      normalizedCardJson: { skills: [{ id: "public" }], capabilities: { extensions: [{ uri: SKILL_ROUTING_EXTENSION }, { uri: APPROVAL_REQUEST_EXTENSION_URI }] } } } as never);
    const person = (subject: string, role: "admin" | "operator" | "viewer") =>
      provisionIdentity(orm.em.fork(), { issuer: "https://idp.example.test", subject, displayName: subject, organizationId: org.id, role });
    const admin = await person("admin", "admin");
    const operator = await person("operator", "operator");
    const viewer = await person("viewer", "viewer");
    const ungranted = await person("ungranted", "operator");
    const skillScoped = await person("skill-scoped", "operator");
    const grant = (subject: typeof operator, skillId: string | null, permission: "operate" | "read") =>
      orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: subject.membershipId, agentId: agent.id, skillId, permission }));
    await grant(operator, null, "operate");
    await grant(viewer, null, "read");
    await grant(skillScoped, "public", "operate");
    const commands = () => orm.em.fork().count(TaskCommandEntity, {});

    // Each Phase 6 payload is refused exactly like a plain message for a viewer, an ungranted operator and a skill-scoped
    // operator sending agent-wide, and nothing is stored; a granted operator's payload is stored as sent, uninterpreted.
    let index = 0;
    for (const [label, body] of PAYLOADS) {
      const before = await commands();
      for (const [who, principal, status] of [["viewer", viewer, 403], ["ungranted operator", ungranted, 403], ["skill-scoped operator, agent-wide", skillScoped, 403]] as const) {
        await expect(withPrincipal(principal, () => acceptCommand(agent.id, body, `refused-${index}-${who}`, { orm, store })), `${label} by ${who}`).rejects.toMatchObject({ status });
      }
      expect(await commands(), `${label}: nothing stored after refusals`).toBe(before);
      const accepted = await withPrincipal(operator, () => acceptCommand(agent.id, body, `allowed-${index}`, { orm, store }));
      const payload = JSON.parse(Buffer.from((await store.get(org.id, accepted.payloadObjectKey.split("/")[1]!))!).toString("utf8"));
      if (body.parts) expect(payload.parts, label).toEqual(body.parts);
      expect(payload.requestMetadata?.[SKILL_ROUTING_EXTENSION], `${label}: no routing scope smuggled in`).toBeUndefined();
      index++;
    }
    // A message that merely claims an approval creates no decision and executes nothing.
    expect(await orm.em.fork().count(DecisionEntity, {})).toBe(0);
    expect(await orm.em.fork().count(DecisionRequestEntity, {})).toBe(0);

    // An agent-originated request is visible and decidable only to people with the right grants, and never by the agent.
    const taskId = randomUUID();
    await orm.em.getConnection().execute(
      "insert into tasks (id, organization_id, agent_id, tenant, remote_task_id, remote_context_id, kind, state, created_at, updated_at) values (?, ?, ?, '', 'remote-1', 'ctx', 'task', 'TASK_STATE_INPUT_REQUIRED', now(), now())", [taskId, org.id, agent.id]);
    const view = { localId: taskId, taskId: "remote-1", tenant: "", agentId: agent.id, agentName: "A", kind: "task", state: "TASK_STATE_INPUT_REQUIRED", createdAt: "", updatedAt: "", artifacts: [], referenceLinks: {},
      messages: [{ id: "m1", role: "agent", fromStatus: true, timestamp: "", parts: [{ id: "p", kind: "data", mediaType: APPROVAL_REQUEST_MEDIA_TYPE,
        value: { title: "Delete staging", risk: "high", action: { kind: "send_message", text: "Yes, delete staging", taskId: "someone-elses", assignedMembershipId: ungranted.membershipId } } }] }] } as DurableTaskView;
    await orm.em.fork().transactional((tx) => openAgentApprovalIfRequested(tx, org.id, view, store));
    const request = (await orm.em.fork().find(DecisionRequestEntity, {}))[0]!;
    expect(request).toMatchObject({ taskId, agentId: agent.id, requesterUserId: null, assignedMembershipId: null });
    const service = new DecisionService(decisionUnitOfWork({ orm, store }));
    const decide = (principal: typeof operator, key: string) => withPrincipal(principal, () => service.decide({ principal, requestId: request.id, outcome: "approve", rationale: "", expectedRevision: 1, idempotencyKey: key }));
    await expect(withPrincipal(ungranted, () => readDecision(request.id, { orm, store }))).resolves.toBeUndefined();
    await expect(decide(ungranted, "u")).rejects.toMatchObject({ status: 404 });
    await expect(decide(viewer, "v")).rejects.toMatchObject({ status: 403 });
    expect(await orm.em.fork().count(DecisionEntity, {})).toBe(0);
    // The same agent without the advertised extension, or a part naming other tasks' scope, changes none of this.
    const other = await registry.add("https://other.example.test/card");
    await orm.em.fork().transactional((tx) => openAgentApprovalIfRequested(tx, org.id, { ...view, agentId: other.id, localId: randomUUID() }, store));
    expect(await orm.em.fork().count(DecisionRequestEntity, {})).toBe(1);
    const decided = await decide(operator, "operator-approves");
    expect(decided.kind === "decided" && decided.decision.reviewerUserId).toBe(operator.userId);
    // The part's attempted scope fields were never read: the request kept the task's own scope and no assignee.
    expect((await orm.em.fork().findOneOrFail(DecisionRequestEntity, { id: request.id }))).toMatchObject({ taskId, assignedMembershipId: null });
  } finally { await orm.close(true); }
}

async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-phase6-exit-db-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("Phase 6 exit: generated UI cannot bypass authorization (PGlite)", () => {
  it("applies the command and decision checks to every Phase 6 payload", async () => {
    await temporary((directory) => contract({ profile: "pglite", dataDir: join(directory, "db") }, directory));
  });
});
const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
if (process.env.CI === "true" && !postgresUrl) throw new Error("CI must set A2A_TEST_POSTGRES_URL");
if (postgresUrl && !decodeURIComponent(new URL(postgresUrl).pathname).includes("test")) throw new Error("A2A_TEST_POSTGRES_URL must target a test database");
(postgresUrl ? describe : describe.skip)("Phase 6 exit: generated UI cannot bypass authorization (PostgreSQL)", () => {
  it("passes the same contract", async () => {
    await temporary((directory) => contract({ profile: "postgresql", url: postgresUrl! }, directory));
  });
});
