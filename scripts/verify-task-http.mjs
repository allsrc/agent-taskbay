import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

// TSK-002 / TST-002: real Next production HTTP, official SDK and fresh PGlite.
const directory = await mkdtemp(join(tmpdir(), "a2a-task-http-"));
const requestHistory = new Map();
const remoteId = "same-remote-id";
const contextId = "same-context";
let fixturePort;
let sends = 0;
const fixture = createServer(async (request, response) => {
  const agent = request.url.split("/")[1];
  if (request.method === "GET") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ name: `Fixture ${agent}`, description: "Durable task fixture", version: "1.0.0",
      supportedInterfaces: [{ url: `http://127.0.0.1:${fixturePort}/${agent}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
      capabilities: { streaming: true }, defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain"], skills: [] }));
    return;
  }
  let input = "";
  for await (const chunk of request) input += chunk;
  const rpc = JSON.parse(input);
  const key = `${agent}:${rpc.params?.tenant ?? ""}`;
  const status = (state, timestamp) => ({ id: remoteId, contextId, status: { state, timestamp } });
  if (rpc.method === "CancelTask") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: status("TASK_STATE_CANCELED", "2026-10-03T00:00:03Z") }));
  } else if (rpc.method === "SendMessage") {
    sends++;
    requestHistory.set(key, rpc.params.message);
    const text = rpc.params.message.parts?.[0]?.text;
    if (text === "Disconnect") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { task: { id: "disconnect-task", status: { state: "TASK_STATE_COMPLETED" } } } }));
      return;
    }
    if (text === "Shared durable task" || text === "Accepted without browser") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { task: { ...status("TASK_STATE_WORKING", "2026-10-03T00:00:00Z"), history: [rpc.params.message] } } }));
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { message: { messageId: `direct-${agent}`, role: "ROLE_AGENT", parts: [{ text: "Direct answer" }] } } }));
  } else if (["SendStreamingMessage", "SubscribeToTask"].includes(rpc.method)) {
    if (rpc.method === "SendStreamingMessage") requestHistory.set(key, rpc.params.message);
    const events = [
      { task: { ...status("TASK_STATE_WORKING", "2026-10-03T00:00:00Z"), history: [requestHistory.get(key)] } },
      { artifactUpdate: { taskId: remoteId, contextId, artifact: { artifactId: "file", name: "Output", parts: [{ raw: "aGVsbG8=", mediaType: "application/octet-stream" }] }, lastChunk: true } },
      { statusUpdate: { taskId: remoteId, contextId, status: { state: "TASK_STATE_INPUT_REQUIRED", timestamp: "2026-10-03T00:00:02Z", message: { messageId: "question", role: "ROLE_AGENT", parts: [{ text: "Proceed?" }] } }, final: true } },
    ];
    response.setHeader("Content-Type", "text/event-stream");
    response.end(events.map((result) => `data: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result })}\n\n`).join(""));
  } else {
    response.statusCode = 400;
    response.end(JSON.stringify({ error: `Unexpected fixture method: ${rpc.method}` }));
  }
});
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
fixturePort = fixture.address().port;
const env = { ...process.env, A2A_COMMAND_WORKER_MODE: "embedded", A2A_DATABASE_PROFILE: "pglite", A2A_PGLITE_DATA_DIR: join(directory, "db"),
  A2A_ARTIFACT_DATA_DIR: join(directory, "artifacts"), A2A_DATA_DIR: directory, A2A_REGISTERED_AGENTS: "", A2A_ALLOW_PRIVATE_NETWORKS: "true" };
let admin;
let testDatabase;
if (process.env.A2A_HTTP_TEST_PROFILE === "postgresql") {
  const url = new URL(process.env.A2A_TEST_POSTGRES_URL);
  if (!decodeURIComponent(url.pathname).includes("test")) throw new Error("HTTP PostgreSQL verification requires a test database URL.");
  admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  testDatabase = `a2a_ops_http_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create database "${testDatabase}"`);
  url.pathname = "/" + testDatabase;
  env.A2A_DATABASE_PROFILE = "postgresql";
  env.A2A_DATABASE_URL = url.toString();
  env.A2A_COMMAND_WORKER_MODE = "external";
}
let worker;
let workerLog = "";
const appPort = Number(process.env.A2A_HTTP_TEST_PORT ?? 3103);
const base = `http://127.0.0.1:${appPort}`;
let app;
let log = "";
async function start() {
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(appPort)], { env });
  app.stdout.on("data", (data) => { log += data; }); app.stderr.on("data", (data) => { log += data; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (app.exitCode !== null) throw new Error(log);
    try { if ((await fetch(`${base}/tasks`)).ok) return; } catch { /* Wait for listening socket. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Next server did not become ready: ${log}`);
}
async function stop() {
  if (app && app.exitCode === null) {
    const closed = new Promise((resolve) => app.once("exit", resolve));
    app.kill("SIGTERM"); await closed;
  }
}
async function json(path, options = {}) {
  const response = await fetch(`${base}${path}`, { headers: { "Content-Type": "application/json", ...(options.headers ?? {}) }, ...options });
  const body = await response.json();
  assert.ok(response.ok, JSON.stringify(body));
  return body;
}
async function stream(agentId, tenant = "", resubscribe = false) {
  const response = await fetch(`${base}/api/agents/${agentId}/stream`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(resubscribe ? { tenant, taskId: remoteId, resubscribe: true } : { text: "Shared durable task", tenant, messageId: `user-${agentId}-${tenant}` }) });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.ok(!body.includes("event: error"), body);
  const identity = body.match(/event: persisted\ndata: ([^\n]+)/);
  assert.ok(identity, body);
  return JSON.parse(identity[1]).localId;
}
try {
  await promisify(execFile)(process.execPath, ["node_modules/@mikro-orm/cli/cli.js", "migration:up"], { env });
  if (testDatabase) {
    worker = spawn(process.execPath, ["--import", "tsx", "scripts/command-worker.ts"], { env });
    worker.stdout.on("data", (data) => { workerLog += data; });
    worker.stderr.on("data", (data) => { workerLog += data; });
    worker.once("exit", (code) => { if (code) console.error(workerLog); });
  }
  await start();
  const one = (await json("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl: `http://127.0.0.1:${fixturePort}/one/card.json` }) })).agent;
  const two = (await json("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl: `http://127.0.0.1:${fixturePort}/two/card.json` }) })).agent;
  await json("/api/agents"); // Persist the fixture names through live discovery.
  const ids = [await stream(one.id), await stream(two.id), await stream(one.id, "tenant-b")];
  assert.equal(new Set(ids).size, 3);
  assert.equal(await stream(one.id, "", true), ids[0]);
  const initial = await json(`/api/tasks/${ids[0]}`);
  assert.equal(initial.task.state, "TASK_STATE_INPUT_REQUIRED");
  assert.equal(initial.task.messages.length, 2);
  assert.equal(initial.task.title, "Shared durable task");
  const artifactUrl = initial.task.artifacts[0].parts[0].value;
  const artifact = await fetch(base + artifactUrl);
  assert.equal(await artifact.text(), "hello");
  assert.match(artifact.headers.get("content-disposition"), /^attachment/);
  assert.equal(artifact.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await json("/api/tasks?filter=needs-input")).tasks.length, 3);
  // Command API acknowledges persisted intent; no browser stream owns dispatch.
  const commandBody = { text: "Accepted without browser", messageId: "accepted-user", tenant: "tenant-command" };
  const sendsBeforeCommand = sends;
  const accepted = await json(`/api/agents/${one.id}/commands`, { method: "POST", headers: { "Idempotency-Key": "http-command" }, body: JSON.stringify(commandBody) });
  const duplicate = await json(`/api/agents/${one.id}/commands`, { method: "POST", headers: { "Idempotency-Key": "http-command" }, body: JSON.stringify(commandBody) });
  assert.equal(duplicate.command.id, accepted.command.id);
  assert.equal((await fetch(`${base}/api/agents/${one.id}/commands`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "http-command" }, body: JSON.stringify({ text: "Conflict" }) })).status, 409);
  let completed;
  for (let attempt = 0; attempt < 100; attempt++) {
    completed = await json(`/api/commands/${accepted.command.id}`);
    if (completed.command.status === "succeeded") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(completed.command.status, "succeeded");
  assert.equal(sends, sendsBeforeCommand + 1, "Duplicate intent dispatched more than once");
  assert.equal(completed.command.messageId, "accepted-user");
  assert.equal(completed.command.result.event.task.id, remoteId);
  assert.equal((await fetch(`${base}/api/agents/${one.id}/commands`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Missing key" }) })).status, 400);
  assert.equal((await fetch(base + "/api/commands/not-a-uuid")).status, 404);
  // Canceling the browser's stream does not cancel the persisted command.
  const disconnected = await fetch(`${base}/api/agents/${one.id}/stream`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Disconnect", messageId: "disconnect-user" }) });
  const reader = disconnected.body.getReader();
  const firstFrame = new TextDecoder().decode((await reader.read()).value);
  const acceptedMatch = firstFrame.match(/event: accepted\ndata: ([^\n]+)/);
  assert.ok(acceptedMatch, firstFrame);
  const disconnectedId = JSON.parse(acceptedMatch[1]).commandId;
  await reader.cancel();
  let disconnectedCommand;
  for (let attempt = 0; attempt < 100; attempt++) {
    disconnectedCommand = await json(`/api/commands/${disconnectedId}`);
    if (disconnectedCommand.command.status === "succeeded") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(disconnectedCommand.command.status, "succeeded");
  assert.equal(disconnectedCommand.command.result.event.task.id, "disconnect-task");
  await json(`/api/agents/${one.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Direct", messageId: "direct-user" }) });
  assert.equal((await json("/api/tasks")).tasks.length, 5);
  assert.equal((await fetch(base + "/api/tasks/" + remoteId)).status, 404);
  assert.equal((await fetch(base + "/api/tasks?limit=0")).status, 400);
  await stop(); await start();
  assert.deepEqual(await json(`/api/commands/${accepted.command.id}`), completed);
  const cleanOne = await json(`/api/tasks/${ids[0]}`, { headers: { Cookie: "clean-session=one" } });
  const cleanTwo = await json(`/api/tasks/${ids[0]}`, { headers: { Cookie: "clean-session=two" } });
  assert.deepEqual(cleanOne, initial); assert.deepEqual(cleanTwo, initial);
  assert.equal((await json("/api/tasks")).tasks.length, 5);
  await json(`/api/agents/${one.id}/tasks/${remoteId}/cancel?tenant=tenant-b`, { method: "POST" });
  assert.equal((await json(`/api/tasks/${ids[2]}`)).task.state, "TASK_STATE_CANCELED");
  assert.equal((await json(`/api/tasks/${ids[0]}`)).task.state, "TASK_STATE_INPUT_REQUIRED");
  console.log(`Production HTTP task/command smoke passed (${env.A2A_DATABASE_PROFILE}, ${env.A2A_COMMAND_WORKER_MODE} worker). UI: ${base}/tasks/${ids[0]}`);
  if (process.env.A2A_HTTP_TEST_KEEP_SERVER === "true") {
    console.log("Keeping the fixture and production server available for UI verification; press Ctrl-C to finish.");
    await new Promise((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  }
} catch (error) { console.error(log + workerLog); throw error; }
finally {
  await stop();
  if (worker && worker.exitCode === null) { const closed = new Promise((resolve) => worker.once("exit", resolve)); worker.kill("SIGTERM"); await closed; }
  fixture.closeAllConnections(); await new Promise((resolve) => fixture.close(resolve));
  await rm(directory, { recursive: true, force: true });
  if (admin) { try { await admin.query(`drop database "${testDatabase}" with (force)`); } finally { await admin.end(); } }
}
if (process.env.A2A_TEST_POSTGRES_URL && !testDatabase && process.env.A2A_HTTP_TEST_KEEP_SERVER !== "true") {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ["scripts/verify-task-http.mjs"], {
    env: { ...process.env, A2A_HTTP_TEST_PROFILE: "postgresql" }, timeout: 120_000,
  });
  process.stdout.write(stdout); process.stderr.write(stderr);
}
