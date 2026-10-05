import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createDatabaseOrm } from "../src/server/adapters/db/orm.ts";
import { createPersistenceRepositories } from "../src/server/adapters/db/repositories.ts";
import { provisionIdentity } from "../src/server/adapters/db/identity-repository.ts";
import { bootstrapDefaultLocalOrganization } from "../src/server/application/services/bootstrap-default-organization.ts";

// NTF-001/002: real Next production HTTP, a fixture agent that doubles as the webhook receiver, and fresh PGlite.
const directory = await mkdtemp(join(tmpdir(), "a2a-notifications-http-"));
const port = Number(process.env.A2A_NOTIFICATIONS_HTTP_TEST_PORT ?? 3108);
const base = `http://127.0.0.1:${port}`;
const SECRET = "n".repeat(40);
const env = { ...process.env, A2A_AUTH_MODE: "development", A2A_ALLOW_DEVELOPMENT_AUTH: "true", A2A_COMMAND_WORKER_MODE: "embedded",
  A2A_DATABASE_PROFILE: "pglite", A2A_PGLITE_DATA_DIR: join(directory, "db"), A2A_ARTIFACT_DATA_DIR: join(directory, "artifacts"),
  A2A_DATA_DIR: directory, A2A_REGISTERED_AGENTS: "", A2A_ALLOW_PRIVATE_NETWORKS: "true", A2A_ALLOWED_AGENT_ORIGINS: "", A2A_DECISION_SWEEP_MS: "300",
  A2A_NOTIFY_WEBHOOK_URL: "", A2A_NOTIFY_WEBHOOK_SECRET: SECRET, A2A_AUTH_ORIGIN: "" };
let fixturePort, app, log = "";
const hooks = []; let hookStatus = 200;
const fixture = createServer(async (request, response) => {
  let input = ""; for await (const chunk of request) input += chunk;
  if (request.url === "/hook") { hooks.push({ headers: request.headers, body: input }); response.statusCode = hookStatus; response.end("ok"); return; }
  response.setHeader("Content-Type", "application/json");
  if (request.method === "GET") {
    response.end(JSON.stringify({ name: "Notify fixture", description: "fixture", version: "1.0.0",
      supportedInterfaces: [{ url: `http://127.0.0.1:${fixturePort}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
      capabilities: { streaming: false, pushNotifications: false }, defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain"], skills: [] })); return;
  }
  const rpc = JSON.parse(input);
  if (rpc.method !== "SendMessage") { response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Read unavailable" } })); return; }
  const message = rpc.params.message; const text = message.parts[0].text;
  // The agent's reply drives the task through the states that people must be told about.
  const state = text.startsWith("ask") ? "TASK_STATE_INPUT_REQUIRED" : text.startsWith("finish") ? "TASK_STATE_COMPLETED" : "TASK_STATE_WORKING";
  response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { task: { id: message.taskId ?? `task-${text.split(" ")[1] ?? text}`, contextId: "ctx",
    status: { state, timestamp: new Date().toISOString() }, history: [message] } } }));
});
const call = async (path, options = {}) => {
  const response = await fetch(base + path, { ...options, headers: { "Content-Type": "application/json", Origin: base, ...options.headers } });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
};
const until = async (check, label, ms = 20_000) => { for (let i = 0; i < ms / 100; i++) { const value = await check(); if (value) return value; await new Promise((r) => setTimeout(r, 100)); } throw new Error(`Timed out: ${label}\n${log}`); };

try {
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  fixturePort = fixture.address().port;
  env.A2A_ALLOWED_AGENT_ORIGINS = `http://127.0.0.1:${fixturePort}`;
  env.A2A_NOTIFY_WEBHOOK_URL = `http://127.0.0.1:${fixturePort}/hook`;
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
  const send = async (text, taskId) => assert.equal((await call(`/api/agents/${agent.id}/commands`, { method: "POST", headers: { "Idempotency-Key": `${text}-${randomUUID()}` },
    body: JSON.stringify({ text, ...(taskId ? { taskId } : {}) }) })).status, 202);
  const task = async (name) => { await send(`work ${name}`); return until(async () => (await call("/api/tasks")).body.tasks.find((candidate) => candidate.taskId === `task-${name}`), `task ${name}`); };
  const inbox = async (query = "") => (await call(`/api/notifications${query}`)).body;

  // Nothing yet; the endpoint validates input and exposes only the caller's own rows.
  assert.deepEqual(await inbox(), { items: [], next: null, unread: 0 });
  assert.equal((await call("/api/notifications?limit=0")).status, 400);
  assert.equal((await call("/api/notifications?limit=500")).status, 400);
  assert.equal((await call("/api/notifications?unread=maybe")).status, 400);
  assert.equal((await call("/api/notifications?cursor=garbage")).status, 400);
  assert.equal((await call("/api/notifications?extra=1")).status, 400);
  assert.equal((await call("/api/notifications/read", { method: "POST", body: JSON.stringify({}) })).status, 400);
  assert.equal((await call("/api/notifications/read", { method: "POST", body: JSON.stringify({ ids: ["x"] }) })).status, 400);
  assert.equal((await call("/api/notifications/read", { method: "POST", body: JSON.stringify({ ids: [randomUUID()], all: true }) })).status, 400);
  assert.equal((await call("/api/notifications/read", { method: "POST", body: JSON.stringify({ ids: [randomUUID()] }) })).body.updated, 0, "Unknown IDs mark nothing.");

  // Real ingestion path: an owned task asks for input, then finishes; the owner is told each time, exactly once.
  const owned = await task("owned");
  assert.equal((await call(`/api/tasks/${owned.localId}/workflow/claim`, { method: "POST" })).status, 200);
  await send("ask for details", owned.taskId);
  const needsInput = await until(async () => (await inbox()).items.find((item) => item.kind === "task.needs_input"), "needs-input notification");
  assert.deepEqual([needsInput.title, needsInput.link, needsInput.taskId], ["Input needed", `/tasks/${owned.localId}`, owned.localId]);
  await send("finish up", owned.taskId);
  const finished = await until(async () => (await inbox()).items.find((item) => item.kind === "task.finished"), "finished notification");
  assert.equal(finished.title, "Task finished");
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal((await inbox()).items.filter((item) => item.kind === "task.needs_input").length, 1, "A state change notifies once.");
  // An unowned task that needs input tells the eligible reviewers (here, the only operator).
  const loose = await task("loose");
  await send("ask again", loose.taskId);
  await until(async () => (await inbox()).items.some((item) => item.link === `/tasks/${loose.localId}` && item.kind === "task.needs_input"), "unowned needs-input");

  // Overdue work escalated to this member from someone else tells them, naming both.
  const handed = await task("handed");
  assert.equal((await call(`/api/tasks/${handed.localId}/workflow/assign`, { method: "POST", body: JSON.stringify({ assigneeMembershipId: alice.membershipId }) })).status, 200);
  const me = (await call(`/api/reviewers?taskId=${handed.localId}`)).body.reviewers.find((reviewer) => reviewer.self).membershipId;
  assert.equal((await call("/api/escalation-policies", { method: "PUT", body: JSON.stringify({ agentId: null, targetMembershipId: me, enabled: true }) })).status, 200);
  assert.equal((await call(`/api/tasks/${handed.localId}/workflow/due`, { method: "POST", body: JSON.stringify({ dueAt: new Date(Date.now() + 2000).toISOString() }) })).status, 200);
  const escalated = await until(async () => (await inbox()).items.find((item) => item.kind === "task.escalated"), "escalation notification");
  assert.match(escalated.body, /moved from Alice Reviewer to /);

  // Approvals: the requester hears that an unreviewed approval expired (the worker acts as the system).
  const open = { taskId: owned.localId, requestKey: "brief", title: "Short lived", summary: "", risk: "low", action: { kind: "send_message", text: "SECRET-PROPOSAL" },
    expiresAt: new Date(Date.now() + 2000).toISOString(), policy: { separationOfDuties: false } };
  const approvalTask = await task("approval");
  assert.equal((await call("/api/decisions", { method: "POST", body: JSON.stringify({ ...open, taskId: approvalTask.localId }) })).status, 201);
  const expired = await until(async () => (await inbox()).items.find((item) => item.kind === "approval.expired"), "expiry notification");
  assert.match(expired.link, /^\/approvals\/[0-9a-f-]{36}$/);
  assert.ok(!JSON.stringify(await inbox()).includes("SECRET-PROPOSAL"), "Proposal text never appears in notifications.");

  // Read state is durable and personal.
  const all = await inbox("?limit=100");
  assert.ok(all.items.length >= 5);
  assert.equal(all.unread, all.items.length);
  assert.ok(all.items.every((item, index, items) => index === 0 || items[index - 1].createdAt >= item.createdAt));
  const first = all.items[0];
  assert.equal((await call("/api/notifications/read", { method: "POST", body: JSON.stringify({ ids: [first.id] }) })).body.updated, 1);
  assert.equal((await call("/api/notifications/read", { method: "POST", body: JSON.stringify({ ids: [first.id] }) })).body.updated, 0);
  const afterOne = await inbox("?limit=100");
  assert.equal(afterOne.unread, all.items.length - 1);
  assert.notEqual(afterOne.items.find((item) => item.id === first.id).readAt, null);
  assert.equal((await inbox("?unread=true&limit=100")).items.length, all.items.length - 1);
  const walked = []; let cursor = "";
  do { const page = await inbox(`?limit=3${cursor ? `&cursor=${cursor}` : ""}`); walked.push(...page.items.map((item) => item.id)); cursor = page.next ?? ""; } while (cursor);
  assert.deepEqual(walked, all.items.map((item) => item.id), "Paging neither skips nor repeats.");
  assert.ok((await call("/api/notifications/read", { method: "POST", body: JSON.stringify({ all: true }) })).body.updated > 0);
  assert.equal((await inbox()).unread, 0);

  // The external channel: signed, deduplicable, and free of content that notifications withhold.
  await until(() => hooks.length >= all.items.length, "webhook deliveries");
  const seen = new Set();
  for (const hook of hooks) {
    const body = JSON.parse(hook.body);
    assert.equal(hook.headers["x-a2a-ops-signature"], `v1=${createHmac("sha256", SECRET).update(`${hook.headers["x-a2a-ops-timestamp"]}.${hook.body}`).digest("hex")}`);
    assert.equal(hook.headers["x-a2a-ops-delivery"], body.id);
    assert.ok(!seen.has(body.id), "A healthy channel posts each notification once."); seen.add(body.id);
    assert.ok(body.text.includes(body.title) && body.organization === "local");
    assert.ok(!hook.body.includes("SECRET-PROPOSAL") && !hook.body.includes(SECRET) && !hook.headers.cookie && !hook.headers.authorization);
  }
  assert.ok(hooks.some((hook) => JSON.parse(hook.body).kind === "task.escalated" && JSON.parse(hook.body).recipients.includes("Local operator")));

  // Administrators see channel health and can test it end to end; failures retry then recover.
  const status = (await call("/api/notifications/channel")).body;
  assert.equal(status.configured, true); assert.equal(status.enabledForOrganization, true); assert.equal(status.host, `127.0.0.1:${fixturePort}`);
  assert.ok(!JSON.stringify(status).includes(SECRET) && !JSON.stringify(status).includes("/hook"), "The URL path and secret are never exposed.");
  assert.equal(status.counts.failed, 0);
  hookStatus = 500; const beforeTest = hooks.length;
  assert.equal((await call("/api/notifications/test", { method: "POST" })).status, 202);
  const testItem = await until(async () => (await inbox()).items.find((item) => item.kind === "test"), "test notification");
  assert.equal(testItem.title, "Test notification");
  await until(() => hooks.length > beforeTest, "first failed attempt");
  const retrying = await until(async () => { const current = (await call("/api/notifications/channel")).body; return current.counts.pending + current.counts.processing >= 1 ? current : undefined; }, "retry state");
  assert.ok(retrying.counts.pending + retrying.counts.processing >= 1);
  hookStatus = 200;
  // After backoff the same notification is delivered; the failure left the inbox untouched and nothing was given up on.
  await until(async () => (await call("/api/notifications/channel")).body.counts.delivered > status.counts.delivered, "recovery after retry", 40_000);
  assert.equal((await call("/api/notifications/channel")).body.counts.failed, 0);
  assert.equal(JSON.parse(hooks.at(-1).body).kind, "test");
  console.log("Notifications HTTP verification passed.");
} finally {
  if (app?.exitCode === null) { const exited = new Promise((resolve) => app.once("exit", resolve)); app.kill("SIGTERM"); await exited; }
  await new Promise((resolve) => fixture.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
