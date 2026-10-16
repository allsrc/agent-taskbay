import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { startScenarioAgent } from "./fixture-scenario-agent.mjs";
import { cancelOverHttp, outgoingFromParts, restoreRestartAttachments, restartMessageId, runRestart } from "../src/lib/restart-task.ts";
import { sendAndStream } from "../src/lib/client-stream.ts";

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
  assert.deepEqual(fresh.related.references.map((task) => task.localId), [old.localId]);
  assert.deepEqual((await detail(old.localId)).related.referencedBy.map((task) => task.localId), [fresh.localId]);
  assert.equal(fresh.related.references[0].state, "TASK_STATE_CANCELED");
  assert.ok((await call("/api/tasks")).body.tasks.every((task) => task.related === undefined));

  // Three linked tasks: select two, leave the third alone. Every request is an ordinary cancel.
  const makeWorking = async (key, references = []) => {
    const result = await command(key, { text: key, contextId: `ctx-${key}`, config: { referenceTaskIds: references } });
    assert.equal(result.status, "succeeded");
    return (await call("/api/tasks")).body.tasks.find((task) => task.contextId === `ctx-${key}`);
  };
  const relatedFirst = await makeWorking("related-first");
  const relatedUntouched = await makeWorking("related-untouched");
  const relatedSource = await makeWorking("related-source", [relatedFirst.taskId, relatedUntouched.taskId]);
  const relatedView = await detail(relatedSource.localId);
  assert.equal(relatedView.canOperate, true);
  assert.equal(relatedView.cancelable, true);
  assert.equal(relatedView.related.references.length, 2);
  assert.ok(relatedView.related.references.every((task) => task.canOperate && task.cancelable));
  for (const task of [relatedSource, relatedFirst]) {
    const result = await call(`/api/agents/${task.agentId}/tasks/${task.taskId}/cancel`, { method: "POST", headers: { "Idempotency-Key": `related-${task.localId}` } });
    assert.equal(result.status, 200, result.text);
    assert.equal(result.body.result.status.state, "TASK_STATE_CANCELED");
  }
  assert.equal((await detail(relatedUntouched.localId)).state, "TASK_STATE_WORKING");
  assert.equal((await detail(relatedSource.localId)).related.references.find((task) => task.localId === relatedFirst.localId).cancelable, false);
  const summary = { runId: crypto.randomUUID(), requested: 2, canceled: 2, refused: 0, failed: 0 };
  const auditPath = `/api/tasks/${relatedSource.localId}/workflow/cancel-related/audit`;
  for (let retry = 0; retry < 2; retry++) assert.equal((await call(auditPath, { method: "POST", body: JSON.stringify(summary) })).status, 200);
  const trail = await call(`/api/audit?taskId=${relatedSource.localId}&group=commands`);
  assert.equal(trail.status, 200, trail.text);
  const summaries = trail.body.entries.filter((entry) => entry.kind === "task.cancel.related");
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].data.canceled, 2);
  assert.equal((await call(auditPath, { method: "POST", body: JSON.stringify({ ...summary, requested: 3 }) })).status, 400);
  const terminal = await call(`/api/agents/${relatedFirst.agentId}/tasks/${relatedFirst.taskId}/cancel`, { method: "POST", headers: { "Idempotency-Key": "related-after-reload" } });
  assert.equal(terminal.status, 409);
  assert.equal(terminal.body.error.kind, "task_terminal");
  // A refusal does not stop the next selected task, and has its own result.
  const mixedFirst = await makeWorking("mixed-first");
  const mixedLast = await makeWorking("mixed-last", [mixedFirst.taskId]);
  await agent.control({ fail: { method: "CancelTask", error: "TaskNotCancelableError", times: 1 } });
  const mixedResults = [];
  for (const task of [mixedFirst, mixedLast]) mixedResults.push(await call(`/api/agents/${task.agentId}/tasks/${task.taskId}/cancel`, { method: "POST", headers: { "Idempotency-Key": `mixed-${task.localId}` } }));
  assert.equal(mixedResults[0].body.error.kind, "task_not_cancelable");
  assert.equal(mixedResults[1].status, 200);
  assert.equal((await detail(mixedFirst.localId)).state, "TASK_STATE_WORKING");
  assert.equal((await detail(mixedLast.localId)).state, "TASK_STATE_CANCELED");

  // Use the browser's actual restart and streaming helpers through the real command/idempotency path.
  const binary = Buffer.from([0, 1, 128, 255, 10]);
  const attached = await command("restart-attached", { contextId: "ctx-attached", parts: [
    { text: "Analyze this file", mediaType: "text/plain" }, { raw: binary.toString("base64"), mediaType: "text/csv", filename: "input.csv" },
  ] });
  const attachedTask = await detail(attached.result.localId);
  const originalMessage = attachedTask.messages.find((message) => message.role === "user");
  const displayedParts = outgoingFromParts(originalMessage.parts);
  assert.ok(displayedParts.some((part) => part.url?.startsWith("/api/artifacts/")));
  const nativeFetch = globalThis.fetch;
  // A browser supplies its origin and resolves same-origin relative URLs; retain the fixture's native fetch separately.
  globalThis.fetch = (input, options = {}) => nativeFetch(typeof input === "string" && input.startsWith("/") ? base + input : input,
    { ...options, headers: { Origin: base, ...options.headers } });
  try {
    let parts, nextMessageId = restartMessageId(originalMessage.id), replacement;
    const steps = {
      prepare: async () => { parts = await restoreRestartAttachments(displayedParts); },
      cancel: () => cancelOverHttp(attachedTask, "restart-file-cancel"),
      readState: async () => (await detail(attachedTask.localId)).state,
      start: async () => {
        const controller = new AbortController();
        replacement = undefined;
        try {
          await sendAndStream(registered.id, { parts, contextId: attachedTask.contextId, messageId: nextMessageId,
            config: { referenceTaskIds: [attachedTask.taskId] } }, { onSnapshot: (task) => { replacement = task; controller.abort(); } }, controller.signal);
        } catch (error) { if (!replacement) throw error; }
      },
    };
    await agent.control({ fail: { method: "SendMessage", error: "ContentTypeNotSupportedError", times: 1 } });
    const firstTry = await runRestart(steps, "cancel", () => {});
    assert.equal(firstTry.cancel.status, "done");
    assert.equal(firstTry.start.failure.kind, "content_type_not_supported");
    const previous = nextMessageId;
    nextMessageId = restartMessageId(originalMessage.id, previous, firstTry.start.failure);
    assert.notEqual(nextMessageId, previous);
    const retry = await runRestart(steps, "start", () => {}, firstTry);
    assert.equal(retry.start.status, "done");
    assert.equal((await detail(attachedTask.localId)).state, "TASK_STATE_CANCELED");
    const requests = (await agent.state()).log;
    assert.equal(requests.filter((request) => request.method === "CancelTask" && request.params.id === attachedTask.taskId).length, 1);
    const restarted = requests.findLast((request) => request.method === "SendMessage" && request.params.message.messageId === nextMessageId);
    assert.equal(restarted.params.message.parts[1].raw, binary.toString("base64"));
    assert.equal(restarted.params.message.parts[1].url, undefined);
    assert.equal(restarted.params.message.parts[1].filename, "input.csv");
    // Rechecking an uncertain delivery reuses the same command, even if the first request already created the task.
    assert.equal(restartMessageId(originalMessage.id, nextMessageId, { kind: "uncertain", message: "lost response" }), nextMessageId);
    assert.equal((await runRestart(steps, "start", () => {}, retry)).start.status, "done");
    assert.equal((await agent.state()).log.filter((request) => request.method === "SendMessage" && request.params.message.messageId === nextMessageId).length, 1);
  } finally { globalThis.fetch = nativeFetch; }

  console.log("Steering and related cancel HTTP verification passed (pglite, embedded worker).");
} finally {
  if (app?.exitCode === null) { const exited = new Promise((resolve) => app.once("exit", resolve)); app.kill("SIGTERM"); await exited; }
  await agent.close();
  await rm(directory, { recursive: true, force: true });
}
