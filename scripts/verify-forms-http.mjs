import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { FORM_EXTENSION_URI, FORM_MEDIA_TYPE, startFormAgent } from "./fixture-form-agent.mjs";

// INT-002/INT-003: real Next production HTTP against the reference form agent. Proves the discovery contract (extension is
// advertised only by the `form` and `invalid` variants), that the form part is persisted with the task, and that the
// submitted values reach the agent as a single application/json data part and complete the same task.
const directory = await mkdtemp(join(tmpdir(), "a2a-forms-http-"));
const port = Number(process.env.A2A_FORMS_HTTP_TEST_PORT ?? 3107);
const base = `http://127.0.0.1:${port}`;
const fixture = await startFormAgent();
const env = { ...process.env, A2A_ALLOWED_AGENT_ORIGINS: fixture.origin, A2A_AUTH_MODE: "development", A2A_ALLOW_DEVELOPMENT_AUTH: "true",
  A2A_COMMAND_WORKER_MODE: "embedded", A2A_DATABASE_PROFILE: "pglite", A2A_PGLITE_DATA_DIR: join(directory, "db"),
  A2A_ARTIFACT_DATA_DIR: join(directory, "artifacts"), A2A_DATA_DIR: directory, A2A_REGISTERED_AGENTS: "", A2A_ALLOW_PRIVATE_NETWORKS: "true" };
let app, log = "";

async function stop() {
  if (app?.exitCode === null) { const exited = new Promise((resolve) => app.once("exit", resolve)); app.kill("SIGTERM"); await exited; }
  await fixture.close();
}
async function call(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { "Content-Type": "application/json", Origin: base, ...options.headers } });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}
async function until(check, label) {
  for (let attempt = 0; attempt < 200; attempt++) { const value = await check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}\n${log}`);
}
async function send(agentId, key, body) {
  const accepted = await call(`/api/agents/${agentId}/commands`, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(body) });
  assert.equal(accepted.status, 202, accepted.text);
  const id = accepted.body.command.id;
  await until(async () => ["succeeded", "failed", "uncertain"].includes((await call(`/api/commands/${id}`)).body?.command?.status), `command ${key}`);
  assert.equal((await call(`/api/commands/${id}`)).body.command.status, "succeeded", `command ${key} failed\n${log}`);
}
const waitingTask = (agentId, state) => until(async () =>
  ((await call("/api/tasks")).body?.tasks ?? []).find((task) => task.agentId === agentId && task.state === state), `${agentId} ${state}`);

try {
  await promisify(execFile)(process.execPath, ["node_modules/@mikro-orm/cli/cli.js", "migration:up"], { env });
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env });
  app.stdout.on("data", (data) => { log += data; }); app.stderr.on("data", (data) => { log += data; });
  await until(async () => { try { return (await fetch(base + "/api/auth/session")).ok; } catch { return false; } }, "server ready");

  const agents = {};
  for (const variant of ["form", "plain", "invalid"]) agents[variant] = (await call("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl: fixture.cardUrl(variant) }) })).body.agent;
  const listed = (await call("/api/agents")).body.agents;
  const extensionsOf = (variant) => (listed.find((agent) => agent.id === agents[variant].id)?.card?.capabilities?.extensions ?? []).map((extension) => extension.uri);
  assert.ok(extensionsOf("form").includes(FORM_EXTENSION_URI), "form agent must advertise the extension");
  assert.ok(extensionsOf("invalid").includes(FORM_EXTENSION_URI));
  assert.deepEqual(extensionsOf("plain"), [], "plain agent must not advertise it");

  // The agent's input request and its form part are persisted with the task and readable through the task API.
  await send(agents.form.id, "form-start", { text: "Deploy the app" });
  const task = await waitingTask(agents.form.id, "TASK_STATE_INPUT_REQUIRED");
  const detail = (await call(`/api/tasks/${task.localId}`)).body.task;
  const formPart = detail.messages.flatMap((message) => message.parts).find((part) => part.mediaType === FORM_MEDIA_TYPE);
  assert.ok(formPart, JSON.stringify(detail.messages));
  assert.equal(formPart.kind, "data");
  assert.equal(formPart.value.schema.properties.environment.enum[1], "production");

  // Submitting sends exactly one application/json data part on the same task, and the agent completes it.
  const values = { environment: "production", replicas: 3, dryRun: false };
  const before = fixture.received.length;
  await send(agents.form.id, "form-submit", { taskId: task.remoteTaskId ?? task.taskId, contextId: task.contextId ?? undefined, parts: [{ data: values, mediaType: "application/json" }] });
  const reply = fixture.received.slice(before).at(-1).message;
  assert.equal(fixture.received.length, before + 1, "Exactly one message reaches the agent");
  assert.equal(reply.parts.length, 1);
  assert.deepEqual(reply.parts[0].data, values);
  assert.equal(reply.parts[0].mediaType, "application/json");
  const done = await waitingTask(agents.form.id, "TASK_STATE_COMPLETED");
  assert.equal(done.localId, task.localId, "The reply continues the same task");
  assert.ok((await call(`/api/tasks/${done.localId}`)).body.task.messages.some((message) => message.parts.some((part) => part.value === "Deploying 3 replica(s) to production.")));

  // Start-of-task form: the advertised definition is in the card params, and a submission starts a task with one JSON part.
  const startDefinition = (listed.find((agent) => agent.id === agents.form.id)?.card?.capabilities?.extensions ?? []).find((extension) => extension.uri === FORM_EXTENSION_URI)?.params?.startForm;
  assert.equal(startDefinition?.schema?.properties?.service?.type, "string", "card params carry the start form");
  assert.equal((listed.find((agent) => agent.id === agents.plain.id)?.card?.capabilities?.extensions ?? []).length, 0);
  const startValues = { service: "billing", priority: "high" };
  const beforeStart = fixture.received.length;
  await send(agents.form.id, "form-start-task", { parts: [{ data: startValues, mediaType: "application/json" }] });
  const startMessage = fixture.received.slice(beforeStart).at(-1).message;
  assert.equal(fixture.received.length, beforeStart + 1);
  assert.equal(startMessage.taskId ?? undefined, undefined, "A start form begins a new task");
  assert.equal(startMessage.parts.length, 1);
  assert.deepEqual(startMessage.parts[0].data, startValues);
  await until(async () => ((await call("/api/tasks")).body?.tasks ?? []).some((candidate) => candidate.agentId === agents.form.id && candidate.localId !== task.localId && candidate.state === "TASK_STATE_COMPLETED"), "start-form task completed");

  // Non-advertising and malformed variants still persist as ordinary input requests; the UI falls back to the composer.
  for (const variant of ["plain", "invalid"]) {
    await send(agents[variant].id, `${variant}-start`, { text: "Deploy the app" });
    const waiting = await waitingTask(agents[variant].id, "TASK_STATE_INPUT_REQUIRED");
    const part = (await call(`/api/tasks/${waiting.localId}`)).body.task.messages.flatMap((message) => message.parts).find((candidate) => candidate.mediaType === FORM_MEDIA_TYPE);
    assert.ok(part, `${variant}: the data part is kept as ordinary content`);
  }
  console.log("Structured form HTTP verification passed.");
} finally {
  await stop().catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
}
