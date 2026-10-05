import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { FORM_MEDIA_TYPE, startFormAgent } from "./fixture-form-agent.mjs";

// INT-004 / ADR 0021: real Next production HTTP, the reference form agent and the AG-UI adapter. Proves the adapter is off by
// default, refuses bad input before streaming, produces well-formed AG-UI runs through the durable command path, ends input
// requests with interrupts (with the form schema when advertised), resumes on the same task and is idempotent per runId.
const directory = await mkdtemp(join(tmpdir(), "a2a-agui-http-"));
const port = Number(process.env.A2A_AGUI_HTTP_TEST_PORT ?? 3109);
const base = `http://127.0.0.1:${port}`;
const fixture = await startFormAgent();
const baseEnv = { ...process.env, A2A_ALLOWED_AGENT_ORIGINS: fixture.origin, A2A_AUTH_MODE: "development", A2A_ALLOW_DEVELOPMENT_AUTH: "true",
  A2A_COMMAND_WORKER_MODE: "embedded", A2A_DATABASE_PROFILE: "pglite", A2A_PGLITE_DATA_DIR: join(directory, "db"),
  A2A_ARTIFACT_DATA_DIR: join(directory, "artifacts"), A2A_DATA_DIR: directory, A2A_REGISTERED_AGENTS: "", A2A_ALLOW_PRIVATE_NETWORKS: "true" };
let app, log = "";

async function startApp(extra = {}) {
  log = "";
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env: { ...baseEnv, ...extra } });
  app.stdout.on("data", (data) => { log += data; }); app.stderr.on("data", (data) => { log += data; });
  await until(async () => { try { return (await fetch(base + "/api/auth/session")).ok; } catch { return false; } }, "server ready");
}
async function stopApp() {
  if (app?.exitCode === null) { const exited = new Promise((resolve) => app.once("exit", resolve)); app.kill("SIGTERM"); await exited; }
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
/** POSTs a run and returns the parsed SSE events, asserting AG-UI framing and ordering. */
async function run(agentId, body, headers = {}) {
  const response = await fetch(`${base}/api/agents/${agentId}/ag-ui`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream", Origin: base, ...headers }, body: JSON.stringify(body) });
  if (response.status !== 200) return { status: response.status, events: [], text: await response.text() };
  assert.match(response.headers.get("content-type"), /^text\/event-stream/);
  const raw = await response.text();
  const frames = raw.split("\n\n").filter(Boolean);
  const events = frames.map((frame) => { assert.ok(frame.startsWith("data: ") && !frame.includes("\nevent:"), `Bad framing: ${frame}`); return JSON.parse(frame.slice(6)); });
  assert.equal(events[0].type, "RUN_STARTED");
  assert.deepEqual([events[0].threadId, events[0].runId], [body.threadId, body.runId]);
  const terminals = events.filter((event) => ["RUN_FINISHED", "RUN_ERROR"].includes(event.type));
  assert.equal(terminals.length, 1, `Exactly one terminal event: ${raw}`);
  assert.equal(events.at(-1), terminals[0], "The terminal event is last");
  const open = new Set();
  for (const event of events) {
    if (event.type === "TEXT_MESSAGE_START") open.add(event.messageId);
    if (event.type === "TEXT_MESSAGE_CONTENT") assert.ok(open.has(event.messageId), "content follows start");
    if (event.type === "TEXT_MESSAGE_END") assert.ok(open.delete(event.messageId), "end follows start");
  }
  assert.equal(open.size, 0, "No text message left open");
  return { status: 200, events, terminal: terminals[0] };
}
const user = (text, id = "u1") => ({ id, role: "user", content: text });

try {
  await promisify(execFile)(process.execPath, ["node_modules/@mikro-orm/cli/cli.js", "migration:up"], { env: baseEnv });

  // Optional by default: with the flag unset the route does not exist for callers.
  await startApp();
  const agents = {};
  for (const variant of ["form", "plain"]) agents[variant] = (await call("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl: fixture.cardUrl(variant) }) })).body.agent;
  await call("/api/agents");
  const disabled = await run(agents.form.id, { threadId: "t-off", runId: "r-off", messages: [user("hi")] });
  assert.equal(disabled.status, 404);
  assert.equal(fixture.received.length, 0, "A disabled adapter sends nothing to the agent");
  await stopApp();

  await startApp({ A2A_AGUI_ENABLED: "true" });
  const path = (variant) => agents[variant].id;

  // Refusals happen before streaming, as plain HTTP errors, and nothing reaches the agent.
  const bad = [
    [{ threadId: "t", runId: "r" }, 400],
    [{ threadId: "bad id", runId: "r", messages: [user("x")] }, 400],
    [{ threadId: "t", runId: "r", messages: [{ id: "a", role: "user", content: [{ type: "image", source: {} }] }] }, 400],
    [{ threadId: "t", runId: "r", messages: [{ id: "a", role: "assistant", content: "hi" }] }, 400],
    [{ threadId: "t", runId: "r", messages: [user("x")], resume: [{ interruptId: "task:00000000-0000-4000-a000-000000000000", status: "answered", payload: "y" }] }, 404],
    [{ threadId: "t", runId: "r", messages: [user("x")], resume: [{ interruptId: "garbage", status: "answered", payload: "y" }] }, 400],
  ];
  for (const [body, status] of bad) assert.equal((await run(path("form"), body)).status, status, JSON.stringify(body));
  assert.equal((await run("00000000-0000-4000-a000-000000000000", { threadId: "t", runId: "r", messages: [user("x")] })).status, 404);
  assert.equal((await run(path("form"), { threadId: "t", runId: "r", messages: [user("x")] }, { Origin: "https://evil.example" })).status, 403, "Cross-origin POST is refused");
  assert.equal(fixture.received.length, 0, "Refused runs send nothing to the agent");

  // A run through the form agent: events, then an interrupt whose responseSchema is the advertised form.
  const first = await run(path("form"), { threadId: "thread-form", runId: "run-1", messages: [user("Deploy the app")] });
  const interrupt = first.terminal.outcome;
  assert.equal(first.terminal.type, "RUN_FINISHED");
  assert.equal(interrupt.type, "interrupt");
  assert.equal(interrupt.interrupts.length, 1);
  const [pending] = interrupt.interrupts;
  assert.match(pending.id, /^task:[0-9a-f-]{36}$/);
  assert.equal(pending.reason, "input_required");
  assert.equal(pending.message, "Where should I deploy?");
  assert.equal(pending.responseSchema.properties.environment.enum[1], "production");
  assert.ok(first.events.some((event) => event.type === "STATE_SNAPSHOT" && event.snapshot.state === "INPUT_REQUIRED"));
  assert.ok(first.events.some((event) => event.type === "TEXT_MESSAGE_CONTENT" && event.delta === "Where should I deploy?"));
  assert.ok(first.events.some((event) => event.type === "CUSTOM" && event.name === "a2a.part" && event.value.mediaType === FORM_MEDIA_TYPE));
  assert.equal(fixture.received.length, 1);
  assert.equal(fixture.received[0].message.contextId, "thread-form", "threadId is sent as the A2A contextId");

  // The same runId again is the same durable command: nothing is sent twice.
  const repeat = await run(path("form"), { threadId: "thread-form", runId: "run-1", messages: [user("Deploy the app")] });
  assert.equal(repeat.terminal.outcome.type, "interrupt");
  assert.equal(fixture.received.length, 1, "Repeated runId must not dispatch twice");

  // Resuming with a payload object answers the same task with exactly one JSON data part, and the run completes.
  const values = { environment: "production", replicas: 3, dryRun: false };
  const resumed = await run(path("form"), { threadId: "thread-form", runId: "run-2", messages: [user("Deploy the app")], resume: [{ interruptId: pending.id, status: "answered", payload: values }] });
  assert.equal(resumed.terminal.outcome?.type, "success", JSON.stringify(resumed.events));
  assert.ok(resumed.events.some((event) => event.type === "TEXT_MESSAGE_CONTENT" && event.delta === "Deploying 3 replica(s) to production."));
  assert.ok(!resumed.events.some((event) => event.type === "TEXT_MESSAGE_CONTENT" && event.delta === "Where should I deploy?"), "Earlier messages are not replayed");
  assert.equal(fixture.received.length, 2);
  const answer = fixture.received[1].message;
  assert.equal(answer.parts.length, 1);
  assert.deepEqual(answer.parts[0].data, values);
  assert.equal(answer.taskId, fixture.received[1].message.taskId);
  const localTask = pending.id.slice("task:".length);
  assert.equal((await call(`/api/tasks/${localTask}`)).body.task.state, "TASK_STATE_COMPLETED", "The resume completed the same task");

  // An answered interrupt is closed: answering it again is refused, and it is not replayed.
  assert.equal((await run(path("form"), { threadId: "thread-form", runId: "run-3", messages: [user("x")], resume: [{ interruptId: pending.id, status: "answered", payload: "again" }] })).status, 409);
  // A resume from another thread cannot reach the task.
  assert.equal((await run(path("form"), { threadId: "other-thread", runId: "run-4", messages: [user("x")], resume: [{ interruptId: pending.id, status: "answered", payload: "again" }] })).status, 404);
  assert.equal(fixture.received.length, 2);

  // An agent that does not advertise the extension still interrupts, without a schema; string answers reply as text.
  const plain = await run(path("plain"), { threadId: "thread-plain", runId: "p1", messages: [user("Deploy the app")] });
  assert.equal(plain.terminal.outcome.type, "interrupt");
  assert.equal(plain.terminal.outcome.interrupts[0].responseSchema, undefined);

  // Abandoning an interrupt cancels the task and ends the run as cancelled.
  const toCancel = await run(path("form"), { threadId: "thread-cancel", runId: "c1", messages: [user("Deploy the app", "u-c")] });
  const cancelId = toCancel.terminal.outcome.interrupts[0].id;
  const cancelled = await run(path("form"), { threadId: "thread-cancel", runId: "c2", messages: [user("Deploy the app", "u-c")], resume: [{ interruptId: cancelId, status: "abandoned" }] });
  assert.equal(cancelled.terminal.outcome?.type, "cancelled", JSON.stringify(cancelled.events));
  assert.equal(fixture.cancelled.length, 1, "The agent was asked to cancel exactly once");

  // The adapter is a command surface: every accepted run is in the audit trail like any other command.
  const trail = (await call("/api/audit?limit=100")).body.entries;
  const kinds = trail.map((entry) => entry.kind);
  assert.ok(kinds.includes("task.send.accepted"), `send runs are audited: ${kinds}`);
  assert.ok(kinds.includes("task.cancel.accepted"), `an abandoned interrupt is audited as a cancel: ${kinds}`);
  console.log("AG-UI HTTP verification passed.");
} finally {
  await stopApp().catch(() => undefined);
  await fixture.close();
  await rm(directory, { recursive: true, force: true });
}
