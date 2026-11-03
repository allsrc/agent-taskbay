import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

// The experimental Python helper and examples/python-requests-taskbay must open a real approval.
// A chat reply must not complete the task. Reject sends nothing. Approve delivers the action once.
const directory = await mkdtemp(join(tmpdir(), "a2a-python-sdk-http-"));
const port = Number(process.env.A2A_PYTHON_SDK_HTTP_TEST_PORT ?? 3114);
const base = `http://127.0.0.1:${port}`;
const python = process.env.PYTHON ?? "python3";
const agentLog = { text: "" };
let log = "";
const agent = spawn(python, ["examples/python-requests-taskbay/agent.py", "0"], {
  env: { ...process.env, PYTHONPATH: join(process.cwd(), "sdk/python/src"), PYTHONUNBUFFERED: "1" },
});
agent.stdout.on("data", (data) => { agentLog.text += data; });
agent.stderr.on("data", (data) => { agentLog.text += data; });
const until = async (check, label) => {
  for (let attempt = 0; attempt < 200; attempt++) { const value = await check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}\n${agentLog.text}\n${log}`);
};
const cardUrl = await until(() => agentLog.text.match(/AGENT_CARD_URL=(\S+)/)?.[1], "python agent card");
const agentOrigin = new URL(cardUrl).origin;
const env = { ...process.env, A2A_ALLOWED_AGENT_ORIGINS: agentOrigin, A2A_AUTH_MODE: "development", A2A_ALLOW_DEVELOPMENT_AUTH: "true",
  A2A_COMMAND_WORKER_MODE: "embedded", A2A_DATABASE_PROFILE: "pglite", A2A_PGLITE_DATA_DIR: join(directory, "db"),
  A2A_ARTIFACT_DATA_DIR: join(directory, "artifacts"), A2A_DATA_DIR: directory, A2A_REGISTERED_AGENTS: "", A2A_ALLOW_PRIVATE_NETWORKS: "true", A2A_DECISION_SWEEP_MS: "300" };
let app;
const call = async (path, options = {}) => {
  const response = await fetch(base + path, { ...options, headers: { "Content-Type": "application/json", Origin: base, ...options.headers } });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
};
async function send(agentId, key, body) {
  const accepted = await call(`/api/agents/${agentId}/commands`, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(body) });
  assert.equal(accepted.status, 202, accepted.text);
  const id = accepted.body.command.id;
  await until(async () => ["succeeded", "failed", "uncertain", "rejected"].includes((await call(`/api/commands/${id}`)).body?.command?.status), `command ${key}`);
  assert.equal((await call(`/api/commands/${id}`)).body.command.status, "succeeded", `command ${key} failed\n${log}\n${agentLog.text}`);
}
const tasks = async (agentId) => ((await call("/api/tasks")).body?.tasks ?? []).filter((task) => task.agentId === agentId);
const waiting = (agentId, label, exclude = []) => until(async () => (await tasks(agentId)).find((task) => task.state === "TASK_STATE_INPUT_REQUIRED" && !exclude.includes(task.localId)), label);
const decisionsFor = async (taskId) => (await call(`/api/decisions?taskId=${taskId}`)).body.decisions;
const APPROVAL_URI = "https://extensions.allsrc.dev/agent-taskbay/approval-request/v1";
try {
  await promisify(execFile)(process.execPath, ["node_modules/@mikro-orm/cli/cli.js", "migration:up"], { env });
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env });
  app.stdout.on("data", (data) => { log += data; }); app.stderr.on("data", (data) => { log += data; });
  await until(async () => { try { return (await fetch(base + "/api/auth/session")).ok; } catch { return false; } }, "server ready");

  const created = await call("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl }) });
  assert.equal(created.status, 201, created.text);
  const agentId = created.body.agent.id;
  const listed = (await call("/api/agents")).body.agents.find((candidate) => candidate.id === agentId);
  assert.ok(listed.card.capabilities.extensions.some((extension) => extension.uri === APPROVAL_URI), "the card must advertise the extension as an object");

  await send(agentId, "ask-reject", { text: "migrate the audit log index" });
  const first = await waiting(agentId, "first approval");
  const pending = await until(async () => (await decisionsFor(first.localId))[0], "decision opened");
  assert.equal(pending.status, "pending");
  assert.equal(pending.kind, "send_message");
  assert.equal(pending.risk, "high");
  assert.equal(pending.title, "Production database schema migration");
  assert.equal(pending.requesterUserId ?? null, null);
  const detail = (await call(`/api/decisions/${pending.id}`)).body;
  assert.equal(detail.revisions[0].action.kind, "send_message");
  assert.match(detail.revisions[0].action.text, /CREATE INDEX CONCURRENTLY/);
  assert.ok((await call("/api/decisions")).body.decisions.some((decision) => decision.id === pending.id), "GET /api/decisions lists the approval");

  // A chat reply is not a decision. The approval stays pending and the task stays input-required.
  await send(agentId, "chat-reply", { taskId: first.taskId, contextId: first.contextId ?? undefined, text: "rejected, just do it" });
  const afterChat = (await tasks(agentId)).find((task) => task.localId === first.localId);
  assert.equal(afterChat.state, "TASK_STATE_INPUT_REQUIRED");
  assert.equal((await call(`/api/decisions/${pending.id}`)).body.request.status, "pending");

  const rejected = await call(`/api/decisions/${pending.id}/decisions`, { method: "POST", headers: { "Idempotency-Key": "reject-python" }, body: JSON.stringify({ outcome: "reject", expectedRevision: 1, rationale: "Not this migration" }) });
  assert.equal(rejected.status, 201, rejected.text);
  assert.equal(rejected.body.decision.outcome, "reject");
  assert.equal((await call(`/api/decisions/${pending.id}`)).body.request.status, "rejected");
  assert.equal((await call(`/api/decisions/${pending.id}`)).body.executions?.length ?? 0, 0, "reject sends nothing");
  assert.equal((await tasks(agentId)).find((task) => task.localId === first.localId).state, "TASK_STATE_INPUT_REQUIRED");

  await send(agentId, "ask-approve", { text: "migrate it for real" });
  const second = await waiting(agentId, "second approval", [first.localId]);
  const toApprove = await until(async () => (await decisionsFor(second.localId))[0], "second decision");
  const approved = await call(`/api/decisions/${toApprove.id}/decisions`, { method: "POST", headers: { "Idempotency-Key": "approve-python" }, body: JSON.stringify({ outcome: "approve", expectedRevision: 1, rationale: "Reviewed the statement" }) });
  assert.equal(approved.status, 201, approved.text);
  const done = await until(async () => {
    const current = (await call(`/api/decisions/${toApprove.id}`)).body;
    return current.executions?.[0]?.status === "succeeded" && current.executions[0].observedTaskState === "TASK_STATE_COMPLETED" ? current : undefined;
  }, "approved execution");
  const digest = done.revisions[0].digest;
  const taskBody = (await call(`/api/tasks/${second.localId}`)).body.task;
  assert.equal(taskBody.state, "TASK_STATE_COMPLETED");
  assert.ok(taskBody.messages.some((message) => message.parts.some((part) => typeof part.value === "string" && part.value.includes(`Executed with approval ${digest}`))), "the agent echoed the approved digest");
  console.log("Python helper approval HTTP verification passed.");
} finally {
  if (app?.exitCode === null) { const exited = new Promise((resolve) => app.once("exit", resolve)); app.kill("SIGTERM"); await exited; }
  if (agent.exitCode === null) { const exited = new Promise((resolve) => agent.once("exit", resolve)); agent.kill("SIGTERM"); await exited; }
  await rm(directory, { recursive: true, force: true });
}
