import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { A2UI_EXTENSION_URI, A2UI_MEDIA_TYPE, startFormAgent } from "./fixture-form-agent.mjs";

// INT-003 / ADR 0022: real Next production HTTP against the reference agent. Proves discovery of the A2UI extension, that
// the agent's interface envelopes persist unmodified with the task, and that a user's action travels back as one A2UI
// data part on the same task together with the declared client capabilities and the activated extension.
const directory = await mkdtemp(join(tmpdir(), "a2a-a2ui-http-"));
const port = Number(process.env.A2A_A2UI_HTTP_TEST_PORT ?? 3111);
const base = `http://127.0.0.1:${port}`;
const fixture = await startFormAgent();
const env = { ...process.env, A2A_ALLOWED_AGENT_ORIGINS: fixture.origin, A2A_AUTH_MODE: "development", A2A_ALLOW_DEVELOPMENT_AUTH: "true",
  A2A_COMMAND_WORKER_MODE: "embedded", A2A_DATABASE_PROFILE: "pglite", A2A_PGLITE_DATA_DIR: join(directory, "db"),
  A2A_ARTIFACT_DATA_DIR: join(directory, "artifacts"), A2A_DATA_DIR: directory, A2A_REGISTERED_AGENTS: "", A2A_ALLOW_PRIVATE_NETWORKS: "true" };
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
try {
  await promisify(execFile)(process.execPath, ["node_modules/@mikro-orm/cli/cli.js", "migration:up"], { env });
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env });
  app.stdout.on("data", (data) => { log += data; }); app.stderr.on("data", (data) => { log += data; });
  await until(async () => { try { return (await fetch(base + "/api/auth/session")).ok; } catch { return false; } }, "server ready");

  const agent = (await call("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl: fixture.cardUrl("a2ui") }) })).body.agent;
  const listed = (await call("/api/agents")).body.agents.find((candidate) => candidate.id === agent.id);
  const extension = listed.card.capabilities.extensions.find((item) => item.uri === A2UI_EXTENSION_URI);
  assert.ok(extension, "the card advertises the A2UI extension");
  assert.deepEqual(extension.params.supportedCatalogIds, ["https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"]);

  // The agent's interface is persisted exactly as sent, as an ordinary data part of the input request.
  await send(agent.id, "a2ui-start", { text: "Confirm the deploy" });
  const task = await until(async () => ((await call("/api/tasks")).body?.tasks ?? []).find((candidate) => candidate.agentId === agent.id && candidate.state === "TASK_STATE_INPUT_REQUIRED"), "input required");
  const part = (await call(`/api/tasks/${task.localId}`)).body.task.messages.flatMap((message) => message.parts).find((candidate) => candidate.mediaType === A2UI_MEDIA_TYPE);
  assert.ok(part, "the A2UI part is stored");
  assert.equal(part.kind, "data");
  assert.ok(Array.isArray(part.value) && part.value.length === 3);
  assert.deepEqual(part.value.map((envelope) => Object.keys(envelope).find((key) => key !== "version")), ["createSurface", "updateComponents", "updateDataModel"]);

  // The user's action goes back as exactly one A2UI part on the same task, with capabilities declared and the extension activated.
  const action = { version: "v0.9", action: { name: "confirm_deploy", surfaceId: "deploy", sourceComponentId: "confirm", timestamp: "2026-10-05T12:00:00.000Z",
    context: { reason: "Quarterly release", env: ["production"], notify: true } } };
  const before = fixture.received.length;
  await send(agent.id, "a2ui-action", { taskId: task.taskId, contextId: task.contextId ?? undefined, parts: [{ data: action, mediaType: A2UI_MEDIA_TYPE }],
    config: { extensions: [A2UI_EXTENSION_URI], metadata: { a2uiClientCapabilities: { "v0.9": { supportedCatalogIds: ["https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"] } } } } });
  assert.equal(fixture.received.length, before + 1, "exactly one message reaches the agent");
  const sent = fixture.received.at(-1).message;
  assert.equal(sent.parts.length, 1);
  assert.deepEqual(sent.parts[0].data, action);
  assert.equal(sent.parts[0].mediaType, A2UI_MEDIA_TYPE);
  assert.equal(sent.taskId, task.taskId, "the action continues the same task");
  assert.deepEqual(sent.metadata.a2uiClientCapabilities, { "v0.9": { supportedCatalogIds: ["https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"] } });
  const done = await until(async () => ((await call("/api/tasks")).body?.tasks ?? []).find((candidate) => candidate.localId === task.localId && candidate.state === "TASK_STATE_COMPLETED"), "completed");
  assert.equal(done.localId, task.localId);
  assert.ok((await call(`/api/tasks/${task.localId}`)).body.task.messages.some((message) => message.parts.some((candidate) => candidate.value === "Deploy confirmed: Quarterly release (production) notify=true")));
  console.log("A2UI HTTP verification passed.");
} finally {
  if (app?.exitCode === null) { const exited = new Promise((resolve) => app.once("exit", resolve)); app.kill("SIGTERM"); await exited; }
  await fixture.close();
  await rm(directory, { recursive: true, force: true });
}
