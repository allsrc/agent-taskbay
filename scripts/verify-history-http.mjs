import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { startScenarioAgent } from "./fixture-scenario-agent.mjs";

// Real Next production HTTP against the controllable agent: loading the history an agent keeps for a task, on request.
// The agent holds ten history messages for a task Taskbay saw three of; loading adds the other seven, labelled, once.
// Runs on PGlite with embedded workers. Permission rules are proved on both databases by task-history.db.test.ts.
const directory = await mkdtemp(join(tmpdir(), "a2a-history-http-"));
const port = Number(process.env.A2A_HTTP_TEST_PORT ?? 3151);
const base = `http://127.0.0.1:${port}`;
const agent = await startScenarioAgent();
const env = { ...process.env, A2A_ALLOWED_AGENT_ORIGINS: agent.origin, A2A_AUTH_MODE: "development", A2A_ALLOW_DEVELOPMENT_AUTH: "true",
  A2A_COMMAND_WORKER_MODE: "embedded", A2A_DATABASE_PROFILE: "pglite", A2A_PGLITE_DATA_DIR: join(directory, "db"),
  A2A_ARTIFACT_DATA_DIR: join(directory, "artifacts"), A2A_DATA_DIR: directory, A2A_REGISTERED_AGENTS: "", A2A_ALLOW_PRIVATE_NETWORKS: "true" };
delete env.A2A_TASK_DISCOVERY;
let app, log = "";

async function start() {
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env });
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
const message = (id) => ({ messageId: id, role: id.startsWith("u") ? "ROLE_USER" : "ROLE_AGENT", parts: [{ text: `Text of ${id}` }] });
const ids = Array.from({ length: 10 }, (_, index) => (index % 2 ? `a${index}` : `u${index}`));
const seed = (history) => agent.control({ seed: [{ id: "h1", contextId: "ctx-h1", state: "completed", updatedAt: new Date(Date.now() - 60_000).toISOString(), history: history.map(message) }] });
const refresh = (taskId, body = {}) => call(`/api/tasks/${taskId}/history/refresh`, { method: "POST", body: JSON.stringify(body) });
const lastGetTask = async () => (await agent.state()).log.filter((entry) => entry.method === "GetTask").at(-1).params;
let registered;

try {
  await promisify(execFile)(process.execPath, ["node_modules/@mikro-orm/cli/cli.js", "migration:up"], { env });
  await start();
  registered = (await call("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl: agent.cardUrl }) })).body.agent;

  console.log("step 0");
  // Taskbay tracks the task while the agent holds three history messages.
  await seed(ids.slice(0, 3));
  const tracked = await call(`/api/agents/${registered.id}/remote-tasks/track`, { method: "POST", body: JSON.stringify({ taskId: "h1" }) });
  assert.equal(tracked.status, 201, tracked.text);
  const localId = tracked.body.localId;
  const received = (await call(`/api/tasks/${localId}`)).body.task.messages;
  assert.deepEqual(received.map((item) => item.id), ids.slice(0, 3));
  assert.ok(received.every((item) => item.origin === undefined));

  console.log("step 1");
  // The agent now holds ten. Loading returns the seven Taskbay did not have, labelled as agent history; the first three keep their provenance.
  await seed(ids);
  const first = await refresh(localId);
  assert.equal(first.status, 200, first.text);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal(first.body.added, 7);
  assert.equal(first.body.total, 7);
  assert.equal((await lastGetTask()).historyLength, 50, "the default length is 50");
  const detail = (await call(`/api/tasks/${localId}`)).body.task;
  assert.deepEqual(detail.messages.filter((item) => item.origin === "agent-history").map((item) => item.id), ids.slice(3));
  assert.deepEqual(detail.messages.filter((item) => !item.origin).map((item) => item.id), ids.slice(0, 3));

  console.log("step 2");
  // Loading again, with the same or another length, adds nothing.
  assert.equal((await refresh(localId)).body.added, 0);
  const shorter = await refresh(localId, { historyLength: 5 });
  assert.equal(shorter.body.added, 0);
  assert.equal(shorter.body.total, 7);
  assert.equal((await lastGetTask()).historyLength, 5);

  console.log("step 3");
  // The length is validated and the body is strict.
  for (const body of [{ historyLength: 0 }, { historyLength: 201 }, { historyLength: 1.5 }, { historyLength: "50" }, { unknown: true }]) {
    const rejected = await refresh(localId, body);
    assert.equal(rejected.status, 400, JSON.stringify(body));
  }
  assert.equal((await refresh("00000000-0000-4000-8000-000000000000")).status, 404);
  assert.equal((await refresh("not-a-task")).status, 404);

  console.log("step 4");
  // An agent that forgot the task says so by kind, and nothing changes.
  await agent.control({ reset: true });
  const forgotten = await refresh(localId);
  assert.equal(forgotten.status, 409, forgotten.text);
  assert.equal(forgotten.body.error.kind, "task_not_found");
  assert.equal((await call(`/api/tasks/${localId}`)).body.task.messages.length, 10);

  console.log("step 5");
  // Six loads a minute for each task, counted in the database; the answer says when to try again.
  let limited;
  for (let attempt = 0; attempt < 6 && !limited; attempt++) { const result = await refresh(localId); if (result.status === 429) limited = result; }
  assert.ok(limited, "loading history is rate limited");
  assert.equal(limited.headers.get("retry-after"), "60");

  console.log("History HTTP verification passed (pglite, embedded worker).");
} finally {
  await stopServer();
  await agent.close();
  await rm(directory, { recursive: true, force: true });
}
