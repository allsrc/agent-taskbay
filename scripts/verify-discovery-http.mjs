import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { startScenarioAgent } from "./fixture-scenario-agent.mjs";

// Real Next production HTTP against the controllable agent: finding tasks other systems started (browse, then track), answering,
// steering and cancelling them, the per-agent mode and the deployment cap, and automatic discovery in the background.
// Runs on PGlite with embedded workers. Permission rules (viewer, skill-scoped, no grant) are proved on both databases by discovery.db.test.ts.
const directory = await mkdtemp(join(tmpdir(), "a2a-discovery-http-"));
const port = Number(process.env.A2A_DISCOVERY_HTTP_TEST_PORT ?? 3111);
const base = `http://127.0.0.1:${port}`;
const agent = await startScenarioAgent();
const DAY = 86_400_000;
const env = { ...process.env, A2A_ALLOWED_AGENT_ORIGINS: agent.origin, A2A_AUTH_MODE: "development", A2A_ALLOW_DEVELOPMENT_AUTH: "true",
  A2A_COMMAND_WORKER_MODE: "embedded", A2A_DATABASE_PROFILE: "pglite", A2A_PGLITE_DATA_DIR: join(directory, "db"),
  A2A_ARTIFACT_DATA_DIR: join(directory, "artifacts"), A2A_DATA_DIR: directory, A2A_REGISTERED_AGENTS: "", A2A_ALLOW_PRIVATE_NETWORKS: "true" };
delete env.A2A_TASK_DISCOVERY;
let app, log = "";

async function start(extra = {}) {
  log = "";
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env: { ...env, ...extra } });
  app.stdout.on("data", (data) => { log += data; }); app.stderr.on("data", (data) => { log += data; });
  await until(async () => { try { return (await fetch(base + "/api/auth/session")).ok; } catch { return false; } }, "server ready");
}
async function stopServer() {
  if (app?.exitCode === null) { const exited = new Promise((resolve) => app.once("exit", resolve)); app.kill("SIGTERM"); await exited; }
}
async function call(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { "Content-Type": "application/json", Origin: base, ...options.headers } });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null, text };
}
async function until(check, label, attempts = 300) {
  for (let attempt = 0; attempt < attempts; attempt++) { const value = await check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}\n${log.slice(-3000)}`);
}
const iso = (ageMs) => new Date(Date.now() - ageMs).toISOString();
const requests = async (method) => (await agent.state()).log.filter((entry) => entry.method === method);
const browse = (query = "") => call(`/api/agents/${registered.id}/remote-tasks${query}`);
const track = (taskId, tenant) => call(`/api/agents/${registered.id}/remote-tasks/track`, { method: "POST", body: JSON.stringify({ taskId, ...(tenant !== undefined ? { tenant } : {}) }) });
const settings = (body) => call(`/api/agents/${registered.id}/settings`, { method: "PATCH", body: JSON.stringify(body) });
const tasks = async (query = "") => (await call(`/api/tasks${query}`)).body.tasks;
const command = async (key, body) => {
  const accepted = await call(`/api/agents/${registered.id}/commands`, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(body) });
  assert.equal(accepted.status, 202, accepted.text);
  const id = accepted.body.command.id;
  return until(async () => { const found = (await call(`/api/commands/${id}`)).body.command; return ["succeeded", "failed", "uncertain", "rejected"].includes(found.status) ? found : undefined; }, `command ${key}`);
};
let registered;

try {
  await promisify(execFile)(process.execPath, ["node_modules/@mikro-orm/cli/cli.js", "migration:up"], { env });
  await start();
  registered = (await call("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl: agent.cardUrl }) })).body.agent;
  assert.equal((await call("/api/agents")).status, 200);

  console.log("step 0");
  // Browse only (the default). Taskbay lists what the agent has and stores nothing.
  await agent.control({ seed: [
    { id: "work", contextId: "ctx-work", state: "working", updatedAt: iso(60_000) },
    { id: "ask", contextId: "ctx-ask", state: "input-required", updatedAt: iso(60_000) },
    { id: "done-new", contextId: "ctx-done", state: "completed", updatedAt: iso(DAY) },
    { id: "done-old", contextId: "ctx-old", state: "completed", updatedAt: iso(30 * DAY) },
  ] });
  assert.equal((await call(`/api/agents/${registered.id}/discovery`)).body.mode, "browse");
  const listed = await browse();
  assert.equal(listed.status, 200, listed.text);
  assert.deepEqual(listed.body.rows.map((row) => row.taskId).sort(), ["ask", "done-new", "done-old", "work"]);
  assert.ok(listed.body.rows.every((row) => row.tracked === false));
  assert.deepEqual(await tasks(), [], "browsing stored a task");
  assert.equal((await browse("?status=TASK_STATE_INPUT_REQUIRED")).body.rows.length, 1);

  console.log("step 1");
  // Track the task waiting for a person: it is stored as discovered, appears in the inbox, and tracking tells nobody about its current state.
  const tracked = await track("ask");
  assert.equal(tracked.status, 201, tracked.text);
  const discovered = await tasks("?origin=discovered");
  assert.deepEqual(discovered.map((task) => task.localId), [tracked.body.localId]);
  assert.equal((await tasks("?origin=created")).length, 0);
  const detail = (await call(`/api/tasks/${tracked.body.localId}`)).body.task;
  assert.equal(detail.origin, "discovered");
  assert.equal(detail.trackedBy.name.length > 0, true);
  assert.ok((await call("/api/inbox?view=needs-input")).body.items.some((item) => item.taskId === tracked.body.localId));
  assert.equal((await track("ask")).status, 200, "tracking twice returns the same task");
  assert.equal((await browse()).body.rows.find((row) => row.taskId === "ask").tracked, true);
  assert.equal(((await call("/api/notifications")).body.notifications ?? (await call("/api/notifications")).body.items ?? []).length, 0, "tracking must not notify");

  console.log("step 2");
  // Answer it: the message reaches the agent on the same task and context, and the task moves on.
  const answered = await command("answer-ask", { text: "Use the main ledger", taskId: "ask", contextId: "ctx-ask" });
  assert.equal(answered.status, "succeeded", JSON.stringify(answered));
  const sent = (await requests("SendMessage")).at(-1).params.message;
  assert.equal(sent.taskId, "ask");
  assert.equal(sent.contextId, "ctx-ask");
  await until(async () => (await call(`/api/tasks/${tracked.body.localId}`)).body.task.state === "TASK_STATE_COMPLETED", "answered task completes");
  // A finished task is not continued.
  assert.equal((await call(`/api/agents/${registered.id}/commands`, { method: "POST", headers: { "Idempotency-Key": "after" }, body: JSON.stringify({ text: "More", taskId: "ask" }) })).body.error.kind, "task_terminal");

  console.log("step 3");
  // Steer a task that is working: delivered, or refused by the agent with a kind; then cancel it.
  const working = await track("work");
  assert.equal((await command("steer-1", { text: "Focus on March", taskId: "work", contextId: "ctx-work" })).status, "succeeded");
  await agent.control({ rejectInputWhileWorking: true });
  const refused = await command("steer-2", { text: "And April", taskId: "work", contextId: "ctx-work" });
  assert.equal(refused.status, "rejected");
  assert.equal(refused.errorKind, "unsupported_operation");
  await agent.control({ rejectInputWhileWorking: false });
  const cancel = await call(`/api/agents/${registered.id}/tasks/work/cancel`, { method: "POST" });
  assert.equal(cancel.status, 200, cancel.text);
  assert.equal((await call(`/api/tasks/${working.body.localId}`)).body.task.state, "TASK_STATE_CANCELED");

  console.log("step 4");
  // Modes: off refuses browsing and tracking; the settings route validates.
  assert.equal((await settings({ taskDiscovery: "off" })).status, 200);
  assert.equal((await browse()).body.error.kind, "discovery_disabled");
  assert.equal((await track("done-new")).body.error.kind, "discovery_disabled");
  assert.equal((await settings({ taskDiscovery: "browse" })).status, 200);
  assert.equal((await settings({ taskDiscovery: "auto" })).body.error.kind, "discovery_capped", "automatic discovery needs the deployment to allow it");

  console.log("step 5");
  // The deployment cap: off forbids everything.
  await stopServer(); await start({ A2A_TASK_DISCOVERY: "off" });
  assert.equal((await browse()).body.error.kind, "discovery_disabled");
  assert.equal((await call(`/api/agents/${registered.id}/discovery`)).body.canBrowse, false);
  assert.equal((await call("/api/auth/session")).body.taskDiscoveryCap, "off");

  console.log("step 6");
  // Automatic discovery: allowed by the cap, switched on for the agent, found by the worker without anyone browsing.
  await stopServer(); await start({ A2A_TASK_DISCOVERY: "auto" });
  assert.equal((await settings({ taskDiscovery: "auto" })).status, 200);
  await agent.control({ seed: [
    { id: "auto-work", contextId: "ctx-aw", state: "working", updatedAt: iso(60_000) },
    { id: "auto-ask", contextId: "ctx-aa", state: "input-required", updatedAt: iso(60_000) },
    { id: "auto-old", contextId: "ctx-ao", state: "completed", updatedAt: iso(30 * DAY) },
  ] });
  await until(async () => (await tasks("?origin=discovered")).some((task) => task.taskId === "auto-ask"), "automatic discovery stores a waiting task", 600).catch(async (error) => { console.log(JSON.stringify((await call(`/api/agents/${registered.id}/discovery`)).body), JSON.stringify((await agent.state()).log.filter((entry) => entry.method === "ListTasks").slice(-3))); throw error; });
  const found = (await tasks("?origin=discovered")).map((task) => task.taskId);
  assert.ok(found.includes("auto-work") && found.includes("auto-ask"), found.join());
  assert.ok(!found.includes("auto-old"), "a finished task outside the history window must stay on the agent");
  assert.equal(found.filter((id) => id === "done-new").length <= 1, true);
  const automatic = (await tasks("?origin=discovered")).find((task) => task.taskId === "auto-ask");
  assert.equal((await call(`/api/tasks/${automatic.localId}`)).body.task.trackedBy, null);
  const status = (await call(`/api/agents/${registered.id}/discovery`)).body;
  assert.equal(status.mode, "auto");
  assert.ok(status.auto.foundTotal >= 2);
  await until(async () => {
    const body = (await call("/api/notifications")).body;
    return (body.notifications ?? body.items ?? []).some((item) => item.title === "A task started outside Taskbay needs input");
  }, "automatic discovery tells people about work waiting on them");
  assert.equal((await settings({ taskDiscovery: "browse" })).status, 200);

  console.log("step 7");
  // The browse rate limit is kept per person and agent.
  let limited;
  for (let call_ = 0; call_ < 40 && !limited; call_++) { const result = await browse(); if (result.status === 429) limited = result; }
  assert.ok(limited, "browse is rate limited");
  assert.equal(limited.headers.get("retry-after"), "60");

  console.log("Task discovery HTTP verification passed (pglite, embedded worker).");
} finally {
  await stopServer();
  await agent.close();
  await rm(directory, { recursive: true, force: true });
}
