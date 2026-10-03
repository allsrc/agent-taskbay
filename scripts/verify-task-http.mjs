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
const subscriptions = new Map();
let restartReady = false;
const pushConfigs = new Map();
const pushCreates = [];
const pushDeletes = [];
let pushCreateResponseLost = true;
let pollState = "TASK_STATE_WORKING";
let pollGets = 0;
const pollTokens = [];
const pollSnapshot = () => ({ id: "poll-task", contextId, status: { state: pollState, timestamp: pollState === "TASK_STATE_COMPLETED" ? "2026-10-03T03:00:02Z" : "2026-10-03T03:00:01Z" },
  history: pollState === "TASK_STATE_WORKING" ? [] : [{ messageId: "poll-prompt", role: "ROLE_AGENT", parts: [{ text: "Recovered without streaming" }] }],
  artifacts: pollState === "TASK_STATE_WORKING" ? [] : [{ artifactId: "poll-file", parts: [{ raw: "cG9sbA==", mediaType: "text/plain" }] }],
});
const fixture = createServer(async (request, response) => {
  const agent = request.url.split("/")[1];
  if (request.method === "GET") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ name: `Fixture ${agent}`, description: "Durable task fixture", version: "1.0.0",
      supportedInterfaces: [{ url: `http://127.0.0.1:${fixturePort}/${agent}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
      capabilities: { streaming: !["push", "poll"].includes(agent), pushNotifications: agent === "push" }, defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain"], skills: [] }));
    return;
  }
  let input = "";
  for await (const chunk of request) input += chunk;
  const rpc = JSON.parse(input);
  const key = `${agent}:${rpc.params?.tenant ?? ""}`;
  const observedId = rpc.params?.id ?? remoteId;
  const status = (state, timestamp) => ({ id: observedId, contextId, status: { state, timestamp } });
  if (["GetTask", "ListTasks"].includes(rpc.method)) {
    response.setHeader("Content-Type", "application/json");
    if (agent !== "poll") {
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: rpc.method === "ListTasks" ? -32601 : -32001, message: "Read unavailable" } }));
      return;
    }
    assert.equal(rpc.params.tenant, "poll-tenant");
    let result;
    if (rpc.method === "GetTask") {
      assert.equal(rpc.params.id, "poll-task"); pollGets++;
      result = pollSnapshot();
    } else {
      assert.equal(rpc.params.includeArtifacts, true);
      pollTokens.push(rpc.params.pageToken ?? "");
      result = rpc.params.pageToken === "page-two"
        ? { tasks: [pollSnapshot()], nextPageToken: "", pageSize: 100, totalSize: 2 }
        : { tasks: [{ id: "unrelated-poll-task", contextId, status: { state: "TASK_STATE_WORKING" } }], nextPageToken: "page-two", pageSize: 100, totalSize: 2 };
    }
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
  } else if (rpc.method === "GetTaskPushNotificationConfig") {
    response.setHeader("Content-Type", "application/json");
    const config = pushConfigs.get(rpc.params.id);
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, ...(config ? { result: config } : { error: { code: -32001, message: "Config not found" } }) }));
  } else if (rpc.method === "CreateTaskPushNotificationConfig") {
    assert.equal(agent, "push");
    pushCreates.push(rpc.params);
    pushConfigs.set(rpc.params.id, rpc.params);
    // Simulate remote acceptance followed by loss of the create response.
    if (pushCreateResponseLost) { pushCreateResponseLost = false; request.socket.destroy(); return; }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: rpc.params }));
  } else if (rpc.method === "DeleteTaskPushNotificationConfig") {
    pushDeletes.push(rpc.params.id); pushConfigs.delete(rpc.params.id);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: {} }));
  } else if (rpc.method === "CancelTask") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: status("TASK_STATE_CANCELED", "2026-10-03T00:00:03Z") }));
  } else if (rpc.method === "SendMessage") {
    sends++;
    requestHistory.set(key, rpc.params.message);
    const text = rpc.params.message.parts?.[0]?.text;
    if (agent === "poll") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { task: pollSnapshot() } })); return;
    }
    if (agent === "push") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { task: { id: "push-task", contextId,
        status: { state: "TASK_STATE_WORKING", timestamp: "2026-10-03T02:00:00Z" } } } }));
      return;
    }
    if (["Disconnect", "Worker restart", "Reconnect"].includes(text)) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { task: { id: text === "Disconnect" ? "disconnect-task" : text === "Reconnect" ? "reconnect-task" : "restart-task", status: { state: "TASK_STATE_WORKING" } } } }));
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
    subscriptions.set(observedId, (subscriptions.get(observedId) ?? 0) + 1);
    if (observedId === "restart-task" || observedId === "reconnect-task") {
      response.setHeader("Content-Type", "text/event-stream");
      const emit = (result) => response.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result })}\n\n`);
      emit({ task: status("TASK_STATE_WORKING", "2026-10-03T01:00:00Z") });
      const chunk = { artifactUpdate: { taskId: observedId, artifact: { artifactId: "restart-file", parts: [{ text: "A" }] }, append: true } };
      emit(chunk); emit(chunk); // Legitimate repeated bytes in one stream.
      if (observedId === "restart-task" && !restartReady) return; // Quiet connection interrupted by worker death.
      if (observedId === "reconnect-task" && subscriptions.get(observedId) === 1) { response.end(); return; }
      emit({ artifactUpdate: { taskId: observedId, artifact: { artifactId: "restart-file", parts: [{ text: "B" }] }, append: true, lastChunk: true } });
      emit({ statusUpdate: { taskId: observedId, status: { state: "TASK_STATE_AUTH_REQUIRED", timestamp: "2026-10-03T01:00:02Z",
        message: { messageId: "auth-prompt", role: "ROLE_AGENT", parts: [{ text: "Authorize?" }] } }, final: true } });
      response.end(); return;
    }
    const events = [
      { task: { ...status("TASK_STATE_WORKING", "2026-10-03T00:00:00Z"), history: [requestHistory.get(key)] } },
      { artifactUpdate: { taskId: observedId, contextId, artifact: { artifactId: "file", name: "Output", parts: [{ raw: "aGVsbG8=", mediaType: "application/octet-stream" }] }, lastChunk: true } },
      { statusUpdate: { taskId: observedId, contextId, status: { state: "TASK_STATE_INPUT_REQUIRED", timestamp: "2026-10-03T00:00:02Z", message: { messageId: "question", role: "ROLE_AGENT", parts: [{ text: "Proceed?" }] } }, final: true } },
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
const env = { ...process.env, A2A_AUTH_MODE: "development", A2A_ALLOW_DEVELOPMENT_AUTH: "true", A2A_COMMAND_WORKER_MODE: "embedded", A2A_DATABASE_PROFILE: "pglite", A2A_PGLITE_DATA_DIR: join(directory, "db"),
  A2A_ARTIFACT_DATA_DIR: join(directory, "artifacts"), A2A_DATA_DIR: directory, A2A_REGISTERED_AGENTS: "", A2A_ALLOW_PRIVATE_NETWORKS: "true", A2A_ALLOWED_AGENT_ORIGINS: `http://127.0.0.1:${fixturePort}` };
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
env.A2A_PUSH_CALLBACK_ORIGIN = base;
env.A2A_PUSH_SIGNING_KEY = "ab".repeat(32);
env.A2A_PUSH_ALLOW_LOOPBACK_HTTP = "true";
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
function startWorker() {
  worker = spawn(process.execPath, ["--import", "tsx", "scripts/command-worker.ts"], { env });
  worker.stdout.on("data", (data) => { workerLog += data; });
  worker.stderr.on("data", (data) => { workerLog += data; });
  worker.once("exit", (code) => { if (code) console.error(workerLog); });
}
async function waitTask(localId, predicate) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const result = await json(`/api/tasks/${localId}`);
    if (predicate(result.task)) return result.task;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Task ${localId} did not converge after 30 seconds`);
}
async function waitCommand(commandId) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { command } = await json(`/api/commands/${commandId}`);
    if (command.status === "succeeded") return command;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Command did not complete");
}
async function stop() {
  if (app && app.exitCode === null) {
    const closed = new Promise((resolve) => app.once("exit", resolve));
    app.kill("SIGTERM"); await closed;
  }
}
async function json(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { "Content-Type": "application/json", Origin: base, ...(options.headers ?? {}) } });
  const body = await response.json();
  assert.ok(response.ok, JSON.stringify(body));
  return body;
}
async function stream(agentId, tenant = "", resubscribe = false) {
  const response = await fetch(`${base}/api/agents/${agentId}/stream`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify(resubscribe ? { tenant, taskId: remoteId, resubscribe: true } : { text: "Shared durable task", tenant, messageId: `user-${agentId}-${tenant}` }) });
  assert.equal(response.status, 200);
  const body = await response.text();
  if (body.includes("event: error")) {
    const accepted = body.match(/event: accepted\ndata: ([^\n]+)/);
    const outcome = accepted ? await json(`/api/commands/${JSON.parse(accepted[1]).commandId}`) : null;
    throw new Error(`Stream failed: ${JSON.stringify(outcome)}; ${body}; server: ${log}; worker: ${workerLog}`);
  }
  const snapshots = [...body.matchAll(/event: snapshot\ndata: ([^\n]+)/g)].map((match) => JSON.parse(match[1]));
  assert.equal(snapshots.at(-1)?.state, "TASK_STATE_INPUT_REQUIRED");
  assert.equal(snapshots.at(-1)?.artifacts.length, 1);
  const identity = body.match(/event: persisted\ndata: ([^\n]+)/);
  assert.ok(identity, body);
  return JSON.parse(identity[1]).localId;
}
async function freshnessConnection() {
  const abort = new AbortController();
  const response = await fetch(`${base}/api/tasks/events?organizationId=untrusted`, { signal: abort.signal,
    headers: { "Last-Event-ID": "missed-signal" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  return {
    async next(expected) {
      const timeout = setTimeout(() => abort.abort(), 10_000);
      try {
        while (true) {
          const separator = buffered.indexOf("\n\n");
          if (separator !== -1) {
            const frame = buffered.slice(0, separator); buffered = buffered.slice(separator + 2);
            if (!frame.includes(`event: ${expected}\n`)) continue;
            assert.ok(frame.includes("data: {}"), "Freshness must expose no task content");
            return;
          }
          const chunk = await reader.read();
          assert.ok(!chunk.done, "Freshness stream ended before signal");
          buffered += decoder.decode(chunk.value, { stream: true });
        }
      } finally { clearTimeout(timeout); }
    },
    async close() { abort.abort(); await reader.cancel().catch(() => undefined); },
  };
}
try {
  await promisify(execFile)(process.execPath, ["node_modules/@mikro-orm/cli/cli.js", "migration:up"], { env });
  if (testDatabase) {
    startWorker();
  }
  await start();
  const one = (await json("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl: `http://127.0.0.1:${fixturePort}/one/card.json` }) })).agent;
  const two = (await json("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl: `http://127.0.0.1:${fixturePort}/two/card.json` }) })).agent;
  await json("/api/agents"); // Persist the fixture names through live discovery.
  const liveOne = await freshnessConnection(); const liveTwo = await freshnessConnection();
  await liveOne.next("ready"); await liveTwo.next("ready");
  const ids = [await stream(one.id), await stream(two.id), await stream(one.id, "tenant-b")];
  await liveOne.next("freshness"); await liveTwo.next("freshness");
  // Independent readers re-query projections; signals never fold remote events.
  assert.deepEqual((await json("/api/tasks")).tasks, (await json("/api/tasks")).tasks);
  await liveOne.close(); await liveTwo.close();
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
  const disconnectedTask = await waitTask(disconnectedCommand.command.result.localId, (task) => task.state === "TASK_STATE_INPUT_REQUIRED");
  assert.equal(disconnectedTask.messages.at(-1).parts[0].value, "Proceed?");
  assert.equal(disconnectedTask.artifacts.length, 1);
  // Zero connected live browsers did not stop work. Reconnect forces a durable read,
  // including when Last-Event-ID names a signal that was never observed.
  const recoveredLive = await freshnessConnection();
  await recoveredLive.next("ready");
  assert.equal((await json(`/api/tasks/${disconnectedTask.localId}`)).task.state, "TASK_STATE_INPUT_REQUIRED");
  await recoveredLive.close();
  assert.equal(subscriptions.get("disconnect-task"), 1, "Disconnected browser must leave exactly one worker subscription");
  // A finite lost stream reconnects and replays without a connected browser.
  const reconnect = await json(`/api/agents/${one.id}/commands`, { method: "POST", headers: { "Idempotency-Key": "reconnect" },
    body: JSON.stringify({ text: "Reconnect" }) });
  const reconnectCommand = await waitCommand(reconnect.command.id);
  const reconnectTask = await waitTask(reconnectCommand.result.localId, (task) => task.state === "TASK_STATE_AUTH_REQUIRED");
  assert.equal(reconnectTask.artifacts[0].parts[0].value, "AAB");
  assert.equal(reconnectTask.messages.filter((message) => message.id === "auth-prompt").length, 1);
  assert.equal(subscriptions.get("reconnect-task"), 2);
  // Crash the actual database owner/worker while a quiet stream is leased.
  const restart = await json(`/api/agents/${one.id}/commands`, { method: "POST", headers: { "Idempotency-Key": "restart" },
    body: JSON.stringify({ text: "Worker restart" }) });
  const restartCommand = await waitCommand(restart.command.id);
  await waitTask(restartCommand.result.localId, (task) => task.artifacts[0]?.parts[0]?.value === "AA");
  const owner = testDatabase ? worker : app;
  const crashed = new Promise((resolve) => owner.once("exit", resolve));
  owner.kill("SIGKILL"); await crashed;
  restartReady = true;
  if (testDatabase) startWorker(); else await start();
  const recovered = await waitTask(restartCommand.result.localId, (task) => task.state === "TASK_STATE_AUTH_REQUIRED");
  assert.equal(recovered.artifacts[0].parts[0].value, "AAB");
  assert.equal(recovered.messages.filter((message) => message.id === "auth-prompt").length, 1);
  assert.equal(subscriptions.get("restart-task"), 2);
  assert.equal((await fetch(`${base}/api/agents/${two.id}/stream`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId: "restart-task", resubscribe: true }) })).status, 404);
  await json(`/api/agents/${one.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Direct", messageId: "direct-user" }) });
  assert.equal((await json("/api/tasks")).tasks.length, 7);
  assert.equal((await fetch(base + "/api/tasks/" + remoteId)).status, 404);
  assert.equal((await fetch(base + "/api/tasks?limit=0")).status, 400);
  await stop(); await start();
  assert.deepEqual(await json(`/api/commands/${accepted.command.id}`), completed);
  const cleanOne = await json(`/api/tasks/${ids[0]}`, { headers: { Cookie: "clean-session=one" } });
  const cleanTwo = await json(`/api/tasks/${ids[0]}`, { headers: { Cookie: "clean-session=two" } });
  assert.deepEqual(cleanOne, initial); assert.deepEqual(cleanTwo, initial);
  assert.equal((await json("/api/tasks")).tasks.length, 7);
  // TSK-002/005: both clean browsers rebuild Chat/flows/alerts without visiting
  // task detail first, including direct Messages absent from the task-only inbox.
  async function contentPages(headers) {
    const tasks = []; let after = null;
    do {
      const page = await json(`/api/task-views?limit=2${after ? `&after=${after}` : ""}`, { headers });
      assert.ok(page.tasks.length <= 2);
      tasks.push(...page.tasks); after = page.next;
    } while (after);
    return tasks;
  }
  const browserOne = await contentPages({ Cookie: "clean-session=one" });
  const browserTwo = await contentPages({ Cookie: "clean-session=two" });
  assert.deepEqual(browserOne, browserTwo);
  assert.equal(browserOne.length, 8);
  assert.equal(new Set(browserOne.map((task) => task.localId)).size, 8);
  assert.deepEqual(browserOne.find((task) => task.localId === initial.task.localId), initial.task);
  assert.ok(browserOne.some((task) => task.kind === "message" && task.messages.some((message) => message.parts.some((part) => part.value === "Direct answer"))));
  assert.deepEqual((await json("/api/task-views?organizationId=foreign&tenant=foreign")).tasks, browserOne);
  assert.equal((await fetch(base + "/api/task-views?limit=0")).status, 400);
  assert.equal((await fetch(base + "/api/task-views?after=" + remoteId)).status, 400);
  assert.equal((await fetch(base + "/api/task-views")).headers.get("cache-control"), "no-store");
  await json(`/api/agents/${one.id}/tasks/${remoteId}/cancel?tenant=tenant-b`, { method: "POST" });
  assert.equal((await json(`/api/tasks/${ids[2]}`)).task.state, "TASK_STATE_CANCELED");
  assert.equal((await json("/api/task-views")).tasks.find((task) => task.localId === ids[2]).state, "TASK_STATE_CANCELED");
  assert.equal((await json(`/api/tasks/${ids[0]}`)).task.state, "TASK_STATE_INPUT_REQUIRED");
  // TSK-003/REL-001: SDK-managed push and actual authenticated production route.
  const pushAgent = (await json("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl: `http://127.0.0.1:${fixturePort}/push/card.json` }) })).agent;
  const pushCommand = await json(`/api/agents/${pushAgent.id}/commands`, { method: "POST", headers: { "Idempotency-Key": "push-command" },
    body: JSON.stringify({ text: "Push without a browser", tenant: "push-tenant" }) });
  const pushResult = await waitCommand(pushCommand.command.id);
  for (let attempt = 0; attempt < 100 && pushCreates.length === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(pushCreates.length, 1, "Worker did not register a push config");
  const pushConfig = pushCreates[0];
  assert.equal(pushConfig.taskId, "push-task"); assert.equal(pushConfig.tenant, "push-tenant");
  assert.equal(pushConfig.authentication.scheme, "Bearer");
  const postPush = (event, headers = {}) => fetch(pushConfig.url, { method: "POST", headers: {
    "Content-Type": "application/a2a+json", Authorization: `Bearer ${pushConfig.authentication.credentials}`, ...headers,
  }, body: JSON.stringify(event) });
  const pushArtifact = { artifactUpdate: { taskId: "push-task", contextId,
    artifact: { artifactId: "push-file", parts: [{ raw: "cHVzaA==", mediaType: "text/plain" }] }, lastChunk: true } };
  assert.equal((await postPush(pushArtifact, { Authorization: "Bearer wrong" })).status, 401);
  assert.equal((await postPush({ task: { id: "foreign-task", status: { state: "TASK_STATE_WORKING" } } })).status, 409);
  assert.equal((await postPush({ task: { id: "push-task", tenant: "foreign", status: { state: "TASK_STATE_WORKING" } } })).status, 409);
  assert.equal((await postPush({ task: {}, artifactUpdate: {} })).status, 400);
  assert.equal((await postPush(pushArtifact)).status, 204);
  assert.equal((await postPush(pushArtifact)).status, 204);
  const pushed = await waitTask(pushResult.result.localId, (task) => task.artifacts.length === 1);
  assert.equal(await (await fetch(base + pushed.artifacts[0].parts[0].value)).text(), "push");
  const pushPrompt = { statusUpdate: { taskId: "push-task", contextId, status: { state: "TASK_STATE_INPUT_REQUIRED",
    timestamp: "2026-10-03T02:00:01Z", message: { messageId: "push-prompt", role: "ROLE_AGENT", parts: [{ text: "Push input?" }] } } } };
  assert.equal((await postPush(pushPrompt)).status, 204);
  assert.equal((await postPush(pushPrompt)).status, 204);
  // The lost create response and restart preserve the same config/token; a Get
  // confirms remote acceptance instead of creating a second configuration.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (testDatabase) {
    const closed = new Promise((resolve) => worker.once("exit", resolve)); worker.kill("SIGKILL"); await closed; startWorker();
  }
  await stop(); await start();
  assert.equal((await postPush(pushPrompt)).status, 204);
  const resumedPush = (await json(`/api/tasks/${pushResult.result.localId}`)).task;
  assert.equal(resumedPush.messages.filter((message) => message.id === "push-prompt").length, 1);
  assert.equal(resumedPush.artifacts[0].updateCount, 1);
  assert.equal(pushCreates.length, 1, "Recovery created a second remote push config");
  assert.ok(!JSON.stringify(resumedPush).includes(pushConfig.authentication.credentials));
  assert.ok(!(log + workerLog).includes(pushConfig.authentication.credentials));
  assert.equal((await postPush({ task: { id: "push-task", contextId, status: { state: "TASK_STATE_COMPLETED", timestamp: "2026-10-03T02:00:02Z" } } })).status, 204);
  for (let attempt = 0; attempt < 100 && !pushDeletes.includes(pushConfig.id); attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(pushDeletes.includes(pushConfig.id), "Terminal config was not deleted");
  assert.equal((await postPush(pushPrompt)).status, 401);
  assert.equal((await json(`/api/tasks/${pushResult.result.localId}`)).task.state, "TASK_STATE_COMPLETED");
  // REL-002: a peer with no streaming/push progresses through worker-owned reads.
  const pollAgent = (await json("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl: `http://127.0.0.1:${fixturePort}/poll/card.json` }) })).agent;
  const pollAccepted = await json(`/api/agents/${pollAgent.id}/commands`, { method: "POST", headers: { "Idempotency-Key": "poll-command" },
    body: JSON.stringify({ text: "Poll without browser", tenant: "poll-tenant" }) });
  const pollCommand = await waitCommand(pollAccepted.command.id);
  pollState = "TASK_STATE_INPUT_REQUIRED";
  const polled = await waitTask(pollCommand.result.localId, (task) => task.state === "TASK_STATE_INPUT_REQUIRED");
  assert.equal(polled.messages.filter((message) => message.id === "poll-prompt").length, 1);
  assert.equal(await (await fetch(base + polled.artifacts[0].parts[0].value)).text(), "poll");
  assert.equal(subscriptions.get("poll-task"), undefined);
  const readOwner = testDatabase ? worker : app;
  const readsBeforeRestart = pollGets;
  const pagesBeforeRestart = pollTokens.length;
  const readCrashed = new Promise((resolve) => readOwner.once("exit", resolve));
  readOwner.kill("SIGKILL"); await readCrashed;
  pollState = "TASK_STATE_COMPLETED";
  if (testDatabase) startWorker(); else await start();
  let pollCompleted = await waitTask(pollCommand.result.localId, (task) => task.state === "TASK_STATE_COMPLETED");
  assert.ok(pollGets > 0, "GetTask polling did not run");
  assert.ok(pollGets > readsBeforeRestart || pollTokens.length > pagesBeforeRestart, "Reconciliation reads did not resume after worker restart");
  assert.equal(pollCompleted.messages.filter((message) => message.id === "poll-prompt").length, 1);
  assert.ok(pollTokens.includes("page-two"), "ListTasks pagination did not advance");
  assert.ok(!(await json("/api/tasks")).tasks.some((task) => task.taskId === "unrelated-poll-task"));
  // REL-003: exercise the operator CLI against the same production data and
  // original archives. PostgreSQL stays online; PGlite releases its sole owner.
  const sendsBeforeRebuild = sends;
  if (!testDatabase) await stop();
  for (let pass = 0; pass < 2; pass++) await promisify(execFile)(process.execPath,
    ["--import", "tsx", "scripts/rebuild-projections.ts", "--task", pollCommand.result.localId,
      ...(!testDatabase ? ["--offline-pglite"] : [])], { env });
  if (!testDatabase) await start();
  const rebuiltTask = (await json(`/api/tasks/${pollCommand.result.localId}`)).task;
  assert.ok(rebuiltTask.version >= pollCompleted.version, "Rebuild must not regress the snapshot revision");
  assert.deepEqual(rebuiltTask, { ...pollCompleted, version: rebuiltTask.version });
  pollCompleted = rebuiltTask;
  assert.equal(await (await fetch(base + pollCompleted.artifacts[0].parts[0].value)).text(), "poll");
  assert.equal(sends, sendsBeforeRebuild, "Projection rebuild dispatched user work");
  const restartedLive = await freshnessConnection();
  await restartedLive.next("ready");
  assert.deepEqual((await json(`/api/tasks/${pollCompleted.localId}`)).task, pollCompleted);
  await restartedLive.close();
  console.log(`Production HTTP task/command/subscription/push/reconciliation/rebuild/freshness smoke passed (${env.A2A_DATABASE_PROFILE}, ${env.A2A_COMMAND_WORKER_MODE} worker). UI: ${base}/tasks/${ids[0]}`);
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
