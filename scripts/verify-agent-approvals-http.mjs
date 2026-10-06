import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { APPROVAL_EXTENSION_URI, startFormAgent } from "./fixture-form-agent.mjs";

// HITL-006 / ADR 0023: real Next production HTTP against the reference agent. An agent that advertises the approval-request
// extension can ask for an approval inside its input request; only a person can decide it; the approved content reaches the agent
// once, bound to the approved revision; an agent that does not advertise the extension, or sends a malformed request, opens nothing.
const directory = await mkdtemp(join(tmpdir(), "a2a-agent-approvals-http-"));
const port = Number(process.env.A2A_AGENT_APPROVALS_HTTP_TEST_PORT ?? 3113);
const base = `http://127.0.0.1:${port}`;
const fixture = await startFormAgent();
const env = { ...process.env, A2A_ALLOWED_AGENT_ORIGINS: fixture.origin, A2A_AUTH_MODE: "development", A2A_ALLOW_DEVELOPMENT_AUTH: "true",
  A2A_COMMAND_WORKER_MODE: "embedded", A2A_DATABASE_PROFILE: "pglite", A2A_PGLITE_DATA_DIR: join(directory, "db"),
  A2A_ARTIFACT_DATA_DIR: join(directory, "artifacts"), A2A_DATA_DIR: directory, A2A_REGISTERED_AGENTS: "", A2A_ALLOW_PRIVATE_NETWORKS: "true", A2A_DECISION_SWEEP_MS: "300" };
let app, log = "";
const call = async (path, options = {}) => {
  const response = await fetch(base + path, { ...options, headers: { "Content-Type": "application/json", Origin: base, ...options.headers } });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
};
const until = async (check, label) => {
  for (let attempt = 0; attempt < 200; attempt++) { const value = await check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}\n${log}`);
};
async function send(agentId, key, body) {
  const accepted = await call(`/api/agents/${agentId}/commands`, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(body) });
  assert.equal(accepted.status, 202, accepted.text);
  const id = accepted.body.command.id;
  await until(async () => ["succeeded", "failed", "uncertain"].includes((await call(`/api/commands/${id}`)).body?.command?.status), `command ${key}`);
  assert.equal((await call(`/api/commands/${id}`)).body.command.status, "succeeded", `command ${key} failed\n${log}`);
}
const tasks = async (agentId) => ((await call("/api/tasks")).body?.tasks ?? []).filter((task) => task.agentId === agentId);
const waiting = (agentId, label, exclude = []) => until(async () => (await tasks(agentId)).find((task) => task.state === "TASK_STATE_INPUT_REQUIRED" && !exclude.includes(task.localId)), label);
const decisions = async (taskId) => (await call(`/api/decisions?taskId=${taskId}`)).body.decisions;
try {
  await promisify(execFile)(process.execPath, ["node_modules/@mikro-orm/cli/cli.js", "migration:up"], { env });
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env });
  app.stdout.on("data", (data) => { log += data; }); app.stderr.on("data", (data) => { log += data; });
  await until(async () => { try { return (await fetch(base + "/api/auth/session")).ok; } catch { return false; } }, "server ready");

  const agents = {};
  for (const variant of ["approver", "rogue"]) agents[variant] = (await call("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl: fixture.cardUrl(variant) }) })).body.agent;
  const listed = (await call("/api/agents")).body.agents;
  const advertises = (variant) => (listed.find((agent) => agent.id === agents[variant].id).card.capabilities.extensions ?? []).some((extension) => extension.uri === APPROVAL_EXTENSION_URI);
  assert.equal(advertises("approver"), true);
  assert.equal(advertises("rogue"), false);

  // The agent asks inside its input request; a pending request appears with no human requester, and nothing is sent to the agent.
  await send(agents.approver.id, "ask-1", { text: "delete the staging cluster" });
  const task = await waiting(agents.approver.id, "approver waiting");
  const request = await until(async () => (await decisions(task.localId))[0], "agent-originated request");
  assert.equal(request.status, "pending");
  assert.equal(request.kind, "send_message");
  assert.equal(request.requesterUserId ?? null, null, "no human requester");
  assert.equal(request.risk, "high");
  assert.equal(request.title, "Delete the staging cluster");
  assert.equal(request.agentName.includes("approver"), true);
  assert.ok(Math.abs(Date.parse(request.expiresAt) - Date.now() - 3_600_000) < 60_000, "the agent's lifetime is honoured within bounds");
  const detail = (await call(`/api/decisions/${request.id}`)).body;
  assert.equal(detail.revisions[0].authorType, "agent");
  assert.equal(detail.revisions[0].authorUserId, null);
  assert.deepEqual(detail.revisions[0].action, { kind: "send_message", text: "Yes, delete the staging cluster" });
  assert.equal(fixture.received.length, 1, "Asking for approval sends nothing back to the agent");
  assert.equal((await decisions(task.localId)).length, 1, "Re-observing the same input request opens no second request");

  // An agent that does not advertise the extension, and a malformed request, open nothing; the part stays ordinary content.
  await send(agents.rogue.id, "rogue-1", { text: "delete the production cluster" });
  const rogueTask = await waiting(agents.rogue.id, "rogue waiting");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal((await decisions(rogueTask.localId)).length, 0, "an unadvertised extension is ignored");
  await send(agents.approver.id, "invalid-1", { text: "invalid request please" });
  const invalidTask = await waiting(agents.approver.id, "invalid waiting", [task.localId]);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal((await decisions(invalidTask.localId)).length, 0, "a malformed request is ignored");

  // A later, different request in the same task supersedes the first: only one approval is live.
  await send(agents.approver.id, "ask-again", { taskId: task.taskId, contextId: task.contextId ?? undefined, text: "delete the staging cluster again" });
  const second = await until(async () => (await decisions(task.localId)).find((candidate) => candidate.status === "pending" && candidate.id !== request.id), "second request");
  assert.equal((await call(`/api/decisions/${request.id}`)).body.request.status, "superseded");
  assert.equal((await decisions(task.localId)).filter((candidate) => candidate.status === "pending").length, 1);
  assert.equal((await call(`/api/decisions/${request.id}/decisions`, { method: "POST", headers: { "Idempotency-Key": "stale" }, body: JSON.stringify({ outcome: "approve", expectedRevision: 1 }) })).status, 409, "a superseded request authorizes nothing");

  // A person approves; the agent receives exactly the approved content once, bound to the approved revision.
  const before = fixture.received.length;
  const approved = await call(`/api/decisions/${second.id}/decisions`, { method: "POST", headers: { "Idempotency-Key": "approve-agent-ask" }, body: JSON.stringify({ outcome: "approve", expectedRevision: 1, rationale: "Verified" }) });
  assert.equal(approved.status, 201, approved.text);
  const done = await until(async () => { const current = (await call(`/api/decisions/${second.id}`)).body; return current.executions?.[0]?.status === "succeeded" && current.executions[0].observedTaskState === "TASK_STATE_COMPLETED" ? current : undefined; }, "execution");
  const sent = fixture.received.slice(before).filter((item) => item.message.metadata?.approval);
  assert.equal(sent.length, 1, "exactly one approved message reaches the agent");
  assert.deepEqual(sent[0].message.parts.map((part) => part.text), ["Yes, delete the staging cluster again"]);
  assert.deepEqual(sent[0].message.metadata.approval, { requestId: second.id, decisionId: approved.body.decision.id, revision: 1, revisionDigest: done.revisions[0].digest });
  assert.equal(sent[0].message.taskId, task.taskId, "approval continues the same task");
  assert.ok((await call(`/api/tasks/${task.localId}`)).body.task.messages.some((message) => message.parts.some((part) => typeof part.value === "string" && part.value.includes(`Executed with approval ${done.revisions[0].digest}`))), "the agent echoed the approved digest");

  // A structured request from the agent is edited by a reviewer before approval and sent as one JSON part.
  await send(agents.approver.id, "ask-structured", { text: "structured deploy" });
  const structuredTask = await waiting(agents.approver.id, "structured waiting", [task.localId, invalidTask.localId]);
  const structured = await until(async () => (await decisions(structuredTask.localId))[0], "structured request");
  assert.equal(structured.kind, "send_data");
  const sDetail = (await call(`/api/decisions/${structured.id}`)).body;
  const edited = { kind: "send_data", form: sDetail.revisions[0].action.form, values: { environment: "production", replicas: 3 } };
  const sBefore = fixture.received.length;
  const sDecision = await call(`/api/decisions/${structured.id}/decisions`, { method: "POST", headers: { "Idempotency-Key": "edit-structured" }, body: JSON.stringify({ outcome: "edit", expectedRevision: 1, rationale: "Fewer replicas than asked", edit: edited }) });
  assert.equal(sDecision.status, 201, sDecision.text);
  await until(async () => (await call(`/api/decisions/${structured.id}`)).body.executions?.[0]?.status === "succeeded", "structured execution");
  const sMessage = fixture.received.slice(sBefore).find((item) => item.message.metadata?.approval).message;
  assert.deepEqual(sMessage.parts, [{ data: { environment: "production", replicas: 3, dryRun: false }, mediaType: "application/json" }]);
  assert.equal(sMessage.metadata.approval.revision, 2);

  // Reviewers are told, even though no person made the request.
  await until(async () => JSON.stringify((await call("/api/notifications")).body).includes("Approval needed"), "approval-needed notification");
  assert.ok(JSON.stringify((await call("/api/notifications")).body).includes("Delete the staging cluster"));

  // The audit trail says the agent opened the requests, and a person decided them.
  const trail = (await call("/api/audit?limit=200")).body.entries;
  const opened = trail.find((entry) => entry.kind === "decision.requested" && entry.subjectId === request.id);
  assert.ok(opened, "the agent's request is audited");
  assert.equal(opened.actorUserId ?? null, null);
  assert.equal(opened.data.actorType, "agent");
  assert.ok(trail.some((entry) => entry.kind === "decision.approve" && entry.subjectId === second.id && entry.actorUserId));
  console.log("Agent-originated approval HTTP verification passed.");
} finally {
  if (app?.exitCode === null) { const exited = new Promise((resolve) => app.once("exit", resolve)); app.kill("SIGTERM"); await exited; }
  await fixture.close();
  await rm(directory, { recursive: true, force: true });
}
