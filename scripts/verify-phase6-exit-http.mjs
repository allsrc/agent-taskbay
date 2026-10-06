import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { A2UI_EXTENSION_URI, A2UI_MEDIA_TYPE, APPROVAL_EXTENSION_URI, APPROVAL_MEDIA_TYPE, FORM_EXTENSION_URI, FORM_MEDIA_TYPE, startFormAgent } from "./fixture-form-agent.mjs";

// Phase 6 exit criteria (docs/archive/spec/PHASES.md), exercised against real Next production HTTP:
//  1. one reference agent presents a structured form, an A2UI surface and an approval request;
//  2. an agent whose extensions the console does not know, or does not recognize in a part, falls back safely;
//  3. generated UI cannot run code or bypass authorization (CSP here; authorization in phase6-exit.db.test.ts, rendering in phase6-security.test.tsx).
const directory = await mkdtemp(join(tmpdir(), "a2a-phase6-exit-"));
const port = Number(process.env.A2A_PHASE6_EXIT_HTTP_TEST_PORT ?? 3115);
const base = `http://127.0.0.1:${port}`;
const fixture = await startFormAgent();
const env = { ...process.env, A2A_ALLOWED_AGENT_ORIGINS: fixture.origin, A2A_AUTH_MODE: "development", A2A_ALLOW_DEVELOPMENT_AUTH: "true",
  A2A_COMMAND_WORKER_MODE: "embedded", A2A_DATABASE_PROFILE: "pglite", A2A_PGLITE_DATA_DIR: join(directory, "db"),
  A2A_ARTIFACT_DATA_DIR: join(directory, "artifacts"), A2A_DATA_DIR: directory, A2A_REGISTERED_AGENTS: "", A2A_ALLOW_PRIVATE_NETWORKS: "true", A2A_DECISION_SWEEP_MS: "300" };
let app, log = "";
const call = async (path, options = {}) => {
  const response = await fetch(base + path, { ...options, headers: { "Content-Type": "application/json", Origin: base, ...options.headers } });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text, headers: response.headers };
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
const tasksOf = async (agentId) => ((await call("/api/tasks")).body?.tasks ?? []).filter((task) => task.agentId === agentId);
const detail = async (task) => (await call(`/api/tasks/${task.localId}`)).body.task;
const partsOf = (task) => task.messages.flatMap((message) => message.parts);
const waitingNew = (agentId, known, label) => until(async () => (await tasksOf(agentId)).find((task) => !known.has(task.localId) && task.state === "TASK_STATE_INPUT_REQUIRED"), label);
const sawText = async (task, text) => (await detail(task)).messages.some((message) => message.parts.some((part) => part.value === text || (typeof part.value === "string" && part.value.includes(text))));
try {
  await promisify(execFile)(process.execPath, ["node_modules/@mikro-orm/cli/cli.js", "migration:up"], { env });
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env });
  app.stdout.on("data", (data) => { log += data; }); app.stderr.on("data", (data) => { log += data; });
  await until(async () => { try { return (await fetch(base + "/api/auth/session")).ok; } catch { return false; } }, "server ready");

  const showcase = (await call("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl: fixture.cardUrl("showcase") }) })).body.agent;
  const unknown = (await call("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl: fixture.cardUrl("unknown") }) })).body.agent;
  const listed = (await call("/api/agents")).body.agents;
  const advertised = (agent) => (listed.find((candidate) => candidate.id === agent.id).card.capabilities.extensions ?? []).map((extension) => extension.uri);
  assert.deepEqual(advertised(showcase).sort(), [A2UI_EXTENSION_URI, APPROVAL_EXTENSION_URI, FORM_EXTENSION_URI].sort());
  assert.deepEqual(advertised(unknown), ["https://example.com/extensions/unknown/v9"]);

  // Criterion 1a: one agent presents a structured form; the generic composer remains a working fallback; the form completes the task.
  const known = new Set();
  await send(showcase.id, "form-1", { text: "deploy please" });
  const formTask = await waitingNew(showcase.id, known, "form task"); known.add(formTask.localId);
  assert.ok(partsOf(await detail(formTask)).some((part) => part.mediaType === FORM_MEDIA_TYPE && part.kind === "data" && part.value.schema), "the form is persisted with the task");
  const beforeText = fixture.received.length;
  await send(showcase.id, "form-text", { taskId: formTask.taskId, contextId: formTask.contextId ?? undefined, text: "just let me type" });
  assert.equal(fixture.received.length, beforeText + 1);
  assert.deepEqual(fixture.received.at(-1).message.parts.map((part) => part.text), ["just let me type"], "plain text still reaches the agent while a form is pending");
  await send(showcase.id, "form-values", { taskId: formTask.taskId, contextId: formTask.contextId ?? undefined, parts: [{ data: { environment: "staging", replicas: 2 }, mediaType: "application/json" }] });
  await until(async () => (await tasksOf(showcase.id)).find((task) => task.localId === formTask.localId && task.state === "TASK_STATE_COMPLETED"), "form task completed");

  // Criterion 1b: the same agent presents an A2UI surface and takes the user's action back.
  await send(showcase.id, "surface-1", { text: "show me the surface" });
  const surfaceTask = await waitingNew(showcase.id, known, "surface task"); known.add(surfaceTask.localId);
  const a2ui = partsOf(await detail(surfaceTask)).find((part) => part.mediaType === A2UI_MEDIA_TYPE);
  assert.ok(a2ui && Array.isArray(a2ui.value) && a2ui.value.length === 3, "the interface envelopes are persisted unmodified");
  await send(showcase.id, "surface-action", { taskId: surfaceTask.taskId, contextId: surfaceTask.contextId ?? undefined,
    parts: [{ data: { version: "v0.9", action: { name: "confirm_deploy", surfaceId: "deploy", sourceComponentId: "confirm", timestamp: "2026-10-06T00:00:00.000Z", context: { reason: "exit check", env: ["staging"], notify: false } } }, mediaType: A2UI_MEDIA_TYPE }] });
  await until(async () => (await tasksOf(showcase.id)).find((task) => task.localId === surfaceTask.localId && task.state === "TASK_STATE_COMPLETED"), "surface task completed");
  assert.ok(await sawText(surfaceTask, "Deploy confirmed: exit check"), "the agent acted on the user's A2UI action");

  // Criterion 1c: and asks for an approval that only a person can decide.
  await send(showcase.id, "approve-1", { text: "please approve the deletion" });
  const approvalTask = await waitingNew(showcase.id, known, "approval task"); known.add(approvalTask.localId);
  const request = await until(async () => ((await call(`/api/decisions?taskId=${approvalTask.localId}`)).body.decisions ?? [])[0], "agent request");
  assert.equal(request.status, "pending");
  assert.equal(request.requesterUserId ?? null, null);
  assert.equal(fixture.received.filter((item) => item.message.metadata?.approval).length, 0, "nothing was sent until a person decided");

  // Criterion 2: an agent with only an unknown extension, sending form/A2UI/approval parts it did not advertise, gets none of them
  // interpreted: the parts stay ordinary data, no request is opened, no surface exists to act on, and the composer still works.
  await send(unknown.id, "unknown-1", { text: "hello" });
  const unknownTask = await waitingNew(unknown.id, new Set(), "unknown task");
  const unknownParts = (await detail(unknownTask)).messages.filter((message) => message.role === "agent").flatMap((message) => message.parts);
  assert.deepEqual(unknownParts.map((part) => part.mediaType), ["text/plain", "application/vnd.example.widget+json", FORM_MEDIA_TYPE, A2UI_MEDIA_TYPE, APPROVAL_MEDIA_TYPE], "every part is kept as received");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(((await call(`/api/decisions?taskId=${unknownTask.localId}`)).body.decisions ?? []).length, 0, "an unadvertised approval request opens nothing");
  const beforeUnknown = fixture.received.length;
  await send(unknown.id, "unknown-reply", { taskId: unknownTask.taskId, contextId: unknownTask.contextId ?? undefined, text: "plain reply" });
  assert.deepEqual(fixture.received.at(-1).message.parts.map((part) => part.text), ["plain reply"]);
  assert.equal(fixture.received.length, beforeUnknown + 1);
  assert.equal((await call(`/api/decisions`)).body.decisions.filter((candidate) => candidate.taskId === unknownTask.localId).length, 0);

  // Criterion 3 (browser side): the page's Content-Security-Policy forbids eval, plugins, framing and requests to other origins.
  const page = await fetch(`${base}/chat`);
  const csp = page.headers.get("content-security-policy") ?? "";
  for (const directive of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "connect-src 'self'", "form-action 'self'", "base-uri 'self'"]) assert.ok(csp.includes(directive), `CSP has ${directive}: ${csp}`);
  assert.ok(!/script-src[^;]*unsafe-eval/.test(csp), "production CSP does not allow eval");
  assert.ok(!/script-src[^;]*https?:/.test(csp), "scripts are not allowed from other origins");
  console.log("Phase 6 exit HTTP verification passed.");
} finally {
  if (app?.exitCode === null) { const exited = new Promise((resolve) => app.once("exit", resolve)); app.kill("SIGTERM"); await exited; }
  await fixture.close();
  await rm(directory, { recursive: true, force: true });
}
