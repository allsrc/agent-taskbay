import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { createDatabaseOrm } from "../src/server/adapters/db/orm.ts";
import { createPersistenceRepositories } from "../src/server/adapters/db/repositories.ts";
import { provisionIdentity } from "../src/server/adapters/db/identity-repository.ts";
import { bootstrapDefaultLocalOrganization } from "../src/server/application/services/bootstrap-default-organization.ts";

// HITL-005: real Next production HTTP, a fixture agent and fresh PGlite. A second administrator is provisioned out of band.
const directory = await mkdtemp(join(tmpdir(), "a2a-workflow-http-"));
const port = Number(process.env.A2A_WORKFLOW_HTTP_TEST_PORT ?? 3107);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, A2A_AUTH_MODE: "development", A2A_ALLOW_DEVELOPMENT_AUTH: "true", A2A_COMMAND_WORKER_MODE: "embedded",
  A2A_DATABASE_PROFILE: "pglite", A2A_PGLITE_DATA_DIR: join(directory, "db"), A2A_ARTIFACT_DATA_DIR: join(directory, "artifacts"),
  A2A_DATA_DIR: directory, A2A_REGISTERED_AGENTS: "", A2A_ALLOW_PRIVATE_NETWORKS: "true", A2A_ALLOWED_AGENT_ORIGINS: "", A2A_DECISION_SWEEP_MS: "300" };
let fixturePort, app, log = "";
const fixture = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.method === "GET") {
    response.end(JSON.stringify({ name: "Workflow fixture", description: "fixture", version: "1.0.0",
      supportedInterfaces: [{ url: `http://127.0.0.1:${fixturePort}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
      capabilities: { streaming: false, pushNotifications: false }, defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain"], skills: [] })); return;
  }
  let input = ""; for await (const chunk of request) input += chunk;
  const rpc = JSON.parse(input);
  if (rpc.method !== "SendMessage") { response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Read unavailable" } })); return; }
  const message = rpc.params.message;
  response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { task: { id: `task-${message.parts[0].text}`, contextId: "ctx",
    status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() }, history: [message] } } }));
});
const call = async (path, options = {}) => {
  const response = await fetch(base + path, { ...options, headers: { "Content-Type": "application/json", Origin: base, ...options.headers } });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
};
const until = async (check, label) => { for (let i = 0; i < 200; i++) { const value = await check(); if (value) return value; await new Promise((r) => setTimeout(r, 100)); } throw new Error(`Timed out: ${label}\n${log}`); };

try {
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  fixturePort = fixture.address().port;
  env.A2A_ALLOWED_AGENT_ORIGINS = `http://127.0.0.1:${fixturePort}`;
  await promisify(execFile)(process.execPath, ["node_modules/@mikro-orm/cli/cli.js", "migration:up"], { env });
  Object.assign(process.env, env);
  const orm = await createDatabaseOrm({ profile: "pglite", dataDir: env.A2A_PGLITE_DATA_DIR });
  const org = await bootstrapDefaultLocalOrganization(createPersistenceRepositories(orm.em.fork()).organizations);
  const alice = await provisionIdentity(orm.em.fork(), { issuer: "https://idp.example.test", subject: "alice", organizationId: org.id, displayName: "Alice Reviewer", role: "admin" });
  await orm.close(true);
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env });
  app.stdout.on("data", (d) => { log += d; }); app.stderr.on("data", (d) => { log += d; });
  await until(async () => { try { return (await fetch(base + "/api/auth/session")).ok; } catch { return false; } }, "server ready");

  const agent = (await call("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl: `http://127.0.0.1:${fixturePort}/card.json` }) })).body.agent;
  await call("/api/agents");
  const start = async (name) => {
    assert.equal((await call(`/api/agents/${agent.id}/commands`, { method: "POST", headers: { "Idempotency-Key": name }, body: JSON.stringify({ text: name }) })).status, 202);
    return until(async () => (await call("/api/tasks")).body.tasks.find((task) => task.taskId === `task-${name}`), `task ${name}`);
  };
  const [one, two, three] = [await start("one"), await start("two"), await start("three")];
  const flow = (task, path, body, method = "POST") => call(`/api/tasks/${task.localId}/workflow${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  // Unowned to start; every list row carries its (empty) ownership summary.
  assert.equal((await flow(one, "", undefined, "GET")).body.assignment, null);
  assert.equal((await call("/api/tasks?filter=bogus")).status, 400);
  assert.deepEqual((await call("/api/tasks?filter=mine")).body.tasks, []);
  assert.equal((await call("/api/tasks?filter=unassigned")).body.tasks.length, 3);
  assert.equal((await flow({ localId: "00000000-0000-4000-a000-000000000000" }, "", undefined, "GET")).status, 404);
  assert.equal((await flow({ localId: "nope" }, "", undefined, "GET")).status, 404);

  // Claim, release, assign.
  const claim = await flow(one, "/claim");
  assert.equal(claim.status, 200, claim.text);
  assert.ok(claim.body.assignment.assigneeMembershipId);
  const me = claim.body.assignment.assigneeMembershipId;
  assert.equal((await flow(one, "/claim")).status, 200, "Claiming again is idempotent.");
  const mine = (await call("/api/tasks?filter=mine")).body.tasks;
  assert.deepEqual(mine.map((task) => task.localId), [one.localId]);
  assert.equal(mine[0].workflow.assigneeName, "Local operator");
  assert.deepEqual((await call("/api/tasks?filter=unassigned")).body.tasks.map((task) => task.localId).sort(), [two.localId, three.localId].sort());
  assert.equal((await flow(one, "/assign", { assigneeMembershipId: "not-a-uuid" })).status, 400);
  assert.equal((await flow(one, "/assign", { assigneeMembershipId: randomUUID() })).status, 422);
  const reviewers = (await call(`/api/reviewers?taskId=${one.localId}`)).body.reviewers;
  assert.deepEqual(reviewers.map((reviewer) => reviewer.displayName).sort(), ["Alice Reviewer", "Local operator"]);
  assert.equal((await flow(one, "/assign", { assigneeMembershipId: alice.membershipId })).status, 200);
  assert.equal((await flow(one, "", undefined, "GET")).body.people[alice.membershipId], "Alice Reviewer");
  assert.equal((await flow(one, "/release")).status, 200);
  assert.equal((await flow(one, "", undefined, "GET")).body.assignment.assigneeMembershipId, null);

  // Due times are validated and re-armable; overdue work shows in its own view.
  assert.equal((await flow(two, "/due", { dueAt: new Date(Date.now() - 1000).toISOString() })).status, 400);
  assert.equal((await flow(two, "/due", { dueAt: "tomorrow" })).status, 400);
  assert.equal((await flow(two, "/due", { dueAt: new Date(Date.now() + 3_600_000).toISOString(), extra: 1 })).status, 400);
  assert.equal((await flow(two, "/due", { dueAt: new Date(Date.now() + 3_600_000).toISOString() })).status, 200);
  assert.equal((await flow(two, "/due", { dueAt: null })).body.assignment.dueAt, null);

  // Notes are internal, idempotent and size-limited.
  const noteKey = randomUUID();
  const first = await flow(three, "/notes", { body: "Waiting on finance.", noteKey });
  assert.equal(first.status, 201, first.text);
  const repeat = await flow(three, "/notes", { body: "Waiting on finance.", noteKey });
  assert.equal(repeat.body.note.id, first.body.note.id);
  assert.equal((await flow(three, "/notes", { body: "Different", noteKey })).status, 409);
  assert.equal((await flow(three, "/notes", { body: "", noteKey: randomUUID() })).status, 400);
  assert.equal((await flow(three, "/notes", { body: "x".repeat(4001), noteKey: randomUUID() })).status, 400);
  const notes = (await flow(three, "", undefined, "GET")).body;
  assert.deepEqual(notes.notes.map((note) => note.body), ["Waiting on finance."]);
  assert.equal(notes.people[notes.notes[0].authorUserId], "Local operator");

  // Escalation: a worker, with no one acting, hands overdue owned work to the policy target exactly once.
  assert.equal((await call("/api/escalation-policies", { method: "PUT", body: JSON.stringify({ agentId: null, targetMembershipId: randomUUID(), enabled: true }) })).status, 422);
  assert.equal((await call("/api/escalation-policies", { method: "PUT", body: JSON.stringify({ agentId: null, targetMembershipId: alice.membershipId, enabled: true, extra: 1 }) })).status, 400);
  const saved = await call("/api/escalation-policies", { method: "PUT", body: JSON.stringify({ agentId: null, targetMembershipId: alice.membershipId, enabled: true }) });
  assert.equal(saved.status, 200, saved.text);
  const policies = (await call("/api/escalation-policies")).body;
  assert.equal(policies.policies.length, 1);
  assert.equal(policies.people[alice.membershipId], "Alice Reviewer");
  assert.equal((await flow(three, "/claim")).status, 200);
  assert.equal((await flow(three, "/due", { dueAt: new Date(Date.now() + 2000).toISOString() })).status, 200);
  const escalated = await until(async () => {
    const current = (await flow(three, "", undefined, "GET")).body;
    return current.assignment.escalationLevel === 1 ? current : undefined;
  }, "worker escalation");
  assert.equal(escalated.assignment.assigneeMembershipId, alice.membershipId);
  const event = escalated.events.find((candidate) => candidate.kind === "escalated");
  assert.deepEqual([event.actorUserId, event.fromMembershipId, event.toMembershipId], [null, me, alice.membershipId]);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal((await flow(three, "", undefined, "GET")).body.events.filter((candidate) => candidate.kind === "escalated").length, 1, "Escalates once per due time.");
  const overdueView = (await call("/api/tasks?filter=overdue")).body.tasks;
  assert.deepEqual(overdueView.map((task) => task.localId), [three.localId]);
  assert.equal(overdueView[0].workflow.escalationLevel, 1);
  assert.equal((await call("/api/tasks?filter=mine")).body.tasks.some((task) => task.localId === three.localId), false, "Escalated work left the original owner's queue.");
  // INB-001: the unified inbox reads the same authorized work through one indexed endpoint.
  const inboxOverdue = (await call("/api/inbox?view=overdue")).body;
  assert.deepEqual(inboxOverdue.items.map((item) => item.id), [three.localId]);
  assert.equal(inboxOverdue.items[0].kind, "task");
  assert.equal(inboxOverdue.items[0].escalationLevel, 1);
  const inboxAll = (await call("/api/inbox?view=all&limit=1")).body;
  assert.equal(inboxAll.items.length, 1);
  assert.ok(inboxAll.next, "A second page exists.");
  assert.notEqual((await call(`/api/inbox?view=all&limit=1&cursor=${encodeURIComponent(inboxAll.next)}`)).body.items[0].id, inboxAll.items[0].id);
  assert.equal((await call("/api/inbox?view=bogus")).status, 400);
  assert.equal((await call("/api/inbox?cursor=bad")).status, 400);
  console.log("Workflow HTTP verification passed.");
} finally {
  if (app?.exitCode === null) { const exited = new Promise((resolve) => app.once("exit", resolve)); app.kill("SIGTERM"); await exited; }
  await new Promise((resolve) => fixture.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
