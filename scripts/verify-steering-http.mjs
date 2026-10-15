import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { startScenarioAgent } from "./fixture-scenario-agent.mjs";

// Real Next production HTTP against the controllable agent: what happened to a message sent to a working task (delivered, responded,
// refused), and "stop and restart with this instruction" at API level (cancel, then send a new task that references the old one).
// Runs on PGlite with embedded workers. Outcomes on both databases are proved by steering.db.test.ts.
const directory = await mkdtemp(join(tmpdir(), "a2a-steering-http-"));
const port = Number(process.env.A2A_STEERING_HTTP_TEST_PORT ?? 3173);
const base = `http://127.0.0.1:${port}`;
const agent = await startScenarioAgent();
const env = { ...process.env, A2A_ALLOWED_AGENT_ORIGINS: agent.origin, A2A_AUTH_MODE: "development", A2A_ALLOW_DEVELOPMENT_AUTH: "true",
  A2A_COMMAND_WORKER_MODE: "embedded", A2A_DATABASE_PROFILE: "pglite", A2A_PGLITE_DATA_DIR: join(directory, "db"),
  A2A_ARTIFACT_DATA_DIR: join(directory, "artifacts"), A2A_DATA_DIR: directory, A2A_REGISTERED_AGENTS: "", A2A_ALLOW_PRIVATE_NETWORKS: "true" };
delete env.A2A_TASK_DISCOVERY;
let app, log = "", registered;

async function until(check, label, attempts = 300) {
  for (let attempt = 0; attempt < attempts; attempt++) { const value = await check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}\n${log.slice(-3000)}`);
}
async function call(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { "Content-Type": "application/json", Origin: base, ...options.headers } });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}
const command = async (key, body) => {
  const accepted = await call(`/api/agents/${registered.id}/commands`, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(body) });
  assert.equal(accepted.status, 202, accepted.text);
  const id = accepted.body.command.id;
  return until(async () => { const found = (await call(`/api/commands/${id}`)).body.command; return ["succeeded", "failed", "uncertain", "rejected"].includes(found.status) ? found : undefined; }, `command ${key}`);
};
const track = async (taskId) => (await call(`/api/agents/${registered.id}/remote-tasks/track`, { method: "POST", body: JSON.stringify({ taskId }) })).body.localId;
const detail = async (localId) => (await call(`/api/tasks/${localId}`)).body.task;
const iso = () => new Date(Date.now() - 60_000).toISOString();

try {
  await promisify(execFile)(process.execPath, ["node_modules/@mikro-orm/cli/cli.js", "migration:up"], { env });
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env });
  app.stdout.on("data", (data) => { log += data; }); app.stderr.on("data", (data) => { log += data; });
  await until(async () => { try { return (await fetch(base + "/api/auth/session")).ok; } catch { return false; } }, "server ready");
  registered = (await call("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl: agent.cardUrl }) })).body.agent;
  await agent.control({ seed: ["answers", "ignores", "refuses", "asks"].map((id) => ({ id, contextId: `ctx-${id}`, state: id === "asks" ? "input-required" : "working", updatedAt: iso() })) });

  // The agent answers new input: responded. The list rows carry no steering.
  const answers = await track("answers");
  assert.deepEqual((await detail(answers)).steering, []);
  const first = await command("steer-answers", { text: "Focus on March", taskId: "answers", contextId: "ctx-answers" });
  assert.equal(first.status, "succeeded");
  const steered = await until(async () => { const found = await detail(answers); return found.steering?.[0]?.outcome === "responded" ? found : undefined; }, "responded outcome");
  assert.equal(steered.steering[0].messageId, first.messageId);
  assert.ok((await call("/api/tasks")).body.tasks.every((task) => task.steering === undefined));

  // The agent accepts input but shows nothing: delivered, and it stays that way.
  await agent.control({ ignoreInputWhileWorking: true });
  const ignores = await track("ignores");
  assert.equal((await command("steer-ignores", { text: "Skip April", taskId: "ignores", contextId: "ctx-ignores" })).status, "succeeded");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.deepEqual((await detail(ignores)).steering.map((entry) => entry.outcome), ["delivered"]);
  await agent.control({ ignoreInputWhileWorking: false });

  // The agent refuses: refused with the kind, and the text Taskbay could not put in the task is still returned.
  await agent.control({ rejectInputWhileWorking: true });
  const refuses = await track("refuses");
  const refused = await command("steer-refuses", { text: "Use the old ledger", taskId: "refuses", contextId: "ctx-refuses" });
  assert.equal(refused.status, "rejected");
  assert.deepEqual((await detail(refuses)).steering.map(({ outcome, errorKind, text }) => ({ outcome, errorKind, text })),
    [{ outcome: "refused", errorKind: "unsupported_operation", text: "Use the old ledger" }]);
  await agent.control({ rejectInputWhileWorking: false });

  // A reply to a task that asked for input is not steering, even when the agent refuses it.
  const asks = await track("asks");
  assert.deepEqual((await detail(asks)).steering, []);

  // Stop and restart: cancel, then a new task in the same context that references the old one.
  const started = await command("restart-first", { text: "Reconcile invoices", contextId: "ctx-restart" });
  assert.equal(started.status, "succeeded");
  const old = await until(async () => (await call("/api/tasks")).body.tasks.find((task) => task.contextId === "ctx-restart"), "task to restart");
  // A refused cancel leaves everything as it was: the caller must not send step two.
  await agent.control({ fail: { method: "CancelTask", error: "TaskNotCancelableError", times: 1 } });
  const blocked = await call(`/api/agents/${registered.id}/tasks/${old.taskId}/cancel`, { method: "POST", headers: { "Idempotency-Key": "restart-cancel" } });
  assert.equal(blocked.status, 409, blocked.text);
  assert.equal(blocked.body.error.kind, "task_not_cancelable");
  assert.equal((await detail(old.localId)).state, "TASK_STATE_WORKING");
  assert.equal((await call("/api/tasks")).body.tasks.filter((task) => task.contextId === "ctx-restart").length, 1);
  // Step one retried with a new key succeeds; step two then starts the new task.
  const canceled = await call(`/api/agents/${registered.id}/tasks/${old.taskId}/cancel`, { method: "POST", headers: { "Idempotency-Key": "restart-cancel-2" } });
  assert.equal(canceled.status, 200, canceled.text);
  assert.equal((await detail(old.localId)).state, "TASK_STATE_CANCELED");
  const restart = { text: "Reconcile only March", contextId: "ctx-restart", config: { referenceTaskIds: [old.taskId] } };
  assert.equal((await command("restart-second", restart)).status, "succeeded");
  // The same key again creates no second task.
  assert.equal((await command("restart-second", restart)).status, "succeeded");
  const created = (await call("/api/tasks")).body.tasks.filter((task) => task.contextId === "ctx-restart");
  assert.equal(created.length, 2);
  const fresh = await detail(created.find((task) => task.localId !== old.localId).localId);
  assert.equal(fresh.state, "TASK_STATE_WORKING");
  assert.ok(fresh.messages.some((message) => (message.referenceTaskIds ?? []).includes(old.taskId)), "the new task references the old one");
  assert.equal(fresh.referenceLinks[old.taskId], old.localId);

  console.log("Steering HTTP verification passed (pglite, embedded worker).");
} finally {
  if (app?.exitCode === null) { const exited = new Promise((resolve) => app.once("exit", resolve)); app.kill("SIGTERM"); await exited; }
  await agent.close();
  await rm(directory, { recursive: true, force: true });
}
