import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

// HITL-003/004: real Next production HTTP, a fixture A2A agent and fresh PGlite. The development identity is a single
// administrator, so separation of duties is disabled per request to let one actor open and decide.
const directory = await mkdtemp(join(tmpdir(), "a2a-decisions-http-"));
const port = Number(process.env.A2A_DECISIONS_HTTP_TEST_PORT ?? 3105);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, A2A_ALLOWED_AGENT_ORIGINS: "", A2A_AUTH_MODE: "development", A2A_ALLOW_DEVELOPMENT_AUTH: "true", A2A_COMMAND_WORKER_MODE: "embedded",
  A2A_DATABASE_PROFILE: "pglite", A2A_PGLITE_DATA_DIR: join(directory, "db"), A2A_ARTIFACT_DATA_DIR: join(directory, "artifacts"),
  A2A_DATA_DIR: directory, A2A_REGISTERED_AGENTS: "", A2A_ALLOW_PRIVATE_NETWORKS: "true", A2A_DECISION_SWEEP_MS: "300" };
const received = [];
let fixturePort, app, log = "";

const fixture = createServer(async (request, response) => {
  if (request.method === "GET") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ name: "Approval fixture", description: "Decision fixture", version: "1.0.0",
      supportedInterfaces: [{ url: `http://127.0.0.1:${fixturePort}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
      capabilities: { streaming: false, pushNotifications: false }, defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain"], skills: [] }));
    return;
  }
  let input = ""; for await (const chunk of request) input += chunk;
  const rpc = JSON.parse(input);
  response.setHeader("Content-Type", "application/json");
  if (rpc.method !== "SendMessage") {
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Read unavailable" } })); return;
  }
  const message = rpc.params.message;
  received.push(message);
  const approving = Boolean(message.taskId);
  response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { task: { id: message.taskId ?? (message.parts?.[0]?.text?.includes("Third") ? "approval-task-3" : message.parts?.[0]?.text?.includes("Another") ? "approval-task-2" : "approval-task"), contextId: "approval-context",
    status: { state: approving ? "TASK_STATE_COMPLETED" : "TASK_STATE_INPUT_REQUIRED", timestamp: approving ? "2026-10-05T00:00:02Z" : "2026-10-05T00:00:01Z" },
    history: [message] } } }));
});

async function stop() {
  if (app?.exitCode === null) { const exited = new Promise((resolve) => app.once("exit", resolve)); app.kill("SIGTERM"); await exited; }
  await new Promise((resolve) => fixture.close(resolve));
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

try {
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  fixturePort = fixture.address().port;
  env.A2A_ALLOWED_AGENT_ORIGINS = `http://127.0.0.1:${fixturePort}`;
  await promisify(execFile)(process.execPath, ["node_modules/@mikro-orm/cli/cli.js", "migration:up"], { env });
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env });
  app.stdout.on("data", (data) => { log += data; }); app.stderr.on("data", (data) => { log += data; });
  await until(async () => { try { return (await fetch(base + "/api/auth/session")).ok; } catch { return false; } }, "server ready");

  const agent = (await call("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl: `http://127.0.0.1:${fixturePort}/card.json` }) })).body.agent;
  await call("/api/agents"); // Persist the discovered display name.
  const started = await call(`/api/agents/${agent.id}/commands`, { method: "POST", headers: { "Idempotency-Key": "start" }, body: JSON.stringify({ text: "Begin the cleanup" }) });
  assert.equal(started.status, 202, started.text);
  const commandId = started.body.command.id;
  await until(async () => ["succeeded", "failed", "uncertain"].includes((await call(`/api/commands/${commandId}`)).body?.command?.status), "initial command settled");
  const settled = (await call(`/api/commands/${commandId}`)).body.command;
  assert.equal(settled.status, "succeeded", JSON.stringify(settled));
  const task = await until(async () => {
    const list = (await call("/api/tasks")).body?.tasks ?? [];
    return list.find((candidate) => candidate.state === "TASK_STATE_INPUT_REQUIRED");
  }, "task observed");
  const taskId = task.localId ?? task.id;
  assert.ok(taskId, JSON.stringify(task));
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const open = { taskId, requestKey: "http-open", title: "Approve cleanup", summary: "Agent wants to delete staging", risk: "high",
    action: { kind: "send_message", text: "Yes, delete staging" }, expiresAt, policy: { separationOfDuties: false } };

  // Validation and idempotent open.
  assert.equal((await call("/api/decisions", { method: "POST", body: JSON.stringify({ ...open, expiresAt: new Date(Date.now() - 1000).toISOString() }) })).status, 400);
  assert.equal((await call("/api/decisions", { method: "POST", body: JSON.stringify({ ...open, extra: true }) })).status, 400);
  assert.equal((await call("/api/decisions", { method: "POST", body: JSON.stringify({ ...open, taskId: "00000000-0000-4000-a000-000000000000" }) })).status, 404);
  const created = await call("/api/decisions", { method: "POST", body: JSON.stringify(open) });
  assert.equal(created.status, 201, created.text);
  const repeat = await call("/api/decisions", { method: "POST", body: JSON.stringify(open) });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.decision.id, created.body.decision.id);
  assert.equal((await call("/api/decisions", { method: "POST", body: JSON.stringify({ ...open, action: { kind: "send_message", text: "Different" } }) })).status, 409);
  const id = created.body.decision.id;
  // Display context for the review screens: names, viewer and eligible reviewers, within the caller's scope.
  const reviewers = await call(`/api/reviewers?taskId=${taskId}`);
  assert.equal(reviewers.status, 200, reviewers.text);
  assert.deepEqual(reviewers.body.reviewers.map((reviewer) => [reviewer.displayName, reviewer.self]), [["Local operator", true]]);
  assert.equal((await call("/api/reviewers?taskId=00000000-0000-4000-a000-000000000000")).status, 404);
  assert.equal((await call("/api/reviewers?taskId=nope")).status, 404);
  const firstDetail = (await call(`/api/decisions/${id}`)).body;
  assert.equal(firstDetail.request.agentName, "Approval fixture");
  assert.equal((await call("/api/decisions")).body.decisions[0].agentName, "Approval fixture");
  assert.equal(firstDetail.viewer.role, "admin");
  assert.equal(firstDetail.people[firstDetail.viewer.userId], "Local operator");
  assert.equal(firstDetail.request.requesterUserId, firstDetail.viewer.userId);
  assert.equal((await call(`/api/decisions?status=pending`)).body.decisions.length, 1);
  assert.equal((await call("/api/decisions?status=bogus")).status, 400);
  assert.equal(received.length, 1, "Opening a request must not contact the agent.");

  // Decision input is checked before anything is executed.
  const decideUrl = `/api/decisions/${id}/decisions`;
  const approve = { outcome: "approve", expectedRevision: 1 };
  assert.equal((await call(decideUrl, { method: "POST", body: JSON.stringify(approve) })).status, 400, "An idempotency key is required.");
  assert.equal((await call(decideUrl, { method: "POST", headers: { "Idempotency-Key": "r" }, body: JSON.stringify({ outcome: "reject", expectedRevision: 1 }) })).status, 400);
  assert.equal((await call(decideUrl, { method: "POST", headers: { "Idempotency-Key": "s" }, body: JSON.stringify({ ...approve, expectedRevision: 9 }) })).status, 409);
  assert.equal(received.length, 1);

  // Approve (with a policy-permitted edit), repeat concurrently, then replay: the agent sees exactly one approval.
  const edited = { outcome: "edit", expectedRevision: 1, rationale: "Keep backups", edit: { kind: "send_message", text: "Yes, delete staging but keep backups" } };
  const results = await Promise.all([1, 2, 3].map(() => call(decideUrl, { method: "POST", headers: { "Idempotency-Key": "approve-once" }, body: JSON.stringify(edited) })));
  assert.ok(results.every((result) => [200, 201].includes(result.status)), results.map((result) => result.text).join("\n"));
  assert.equal(results.filter((result) => result.status === 201).length, 1);
  const decisionId = results[0].body.decision.id;
  assert.ok(results.every((result) => result.body.decision.id === decisionId));
  assert.equal((await call(decideUrl, { method: "POST", headers: { "Idempotency-Key": "approve-once" }, body: JSON.stringify({ ...edited, rationale: "Changed" }) })).status, 409);
  assert.equal((await call(decideUrl, { method: "POST", headers: { "Idempotency-Key": "second" }, body: JSON.stringify({ outcome: "reject", rationale: "Too late", expectedRevision: 2 }) })).status, 409);

  // The dispatched message is exactly the approved revision, correlated to the observed task outcome.
  const detail = await until(async () => {
    const current = (await call(`/api/decisions/${id}`)).body;
    return current?.executions?.[0]?.status === "succeeded" && current.executions[0].observedTaskState ? current : undefined;
  }, "execution observed");
  assert.equal(detail.request.status, "approved");
  assert.deepEqual(detail.revisions.map((revision) => revision.action.text), ["Yes, delete staging", "Yes, delete staging but keep backups"]);
  assert.equal(detail.decisions.length, 1);
  assert.equal(detail.decisions[0].revisionId, detail.revisions[1].id);
  assert.equal(detail.decisions[0].revisionDigest, detail.revisions[1].digest);
  assert.deepEqual([detail.executions[0].revisionDigest, detail.executions[0].observedTaskState],
    [detail.revisions[1].digest, "TASK_STATE_COMPLETED"]);
  const approvals = received.filter((message) => message.taskId);
  assert.equal(approvals.length, 1, "The approval must reach the agent exactly once.");
  assert.equal(approvals[0].parts[0].text, "Yes, delete staging but keep backups");
  assert.equal(approvals[0].messageId, `decision-${decisionId}`);
  assert.equal(approvals[0].messageId, detail.executions[0].messageId);

  // Workers, not reviewers, close an overdue request, and live views are told about each change.
  const live = new AbortController();
  let frames = "";
  const stream = await fetch(`${base}/api/tasks/events`, { signal: live.signal });
  (async () => { const decoder = new TextDecoder(); try { for await (const chunk of stream.body) frames += decoder.decode(chunk); } catch { /* Closed by the test. */ } })();
  await until(() => frames.includes("event: ready"), "live stream ready");
  const baseline = (frames.match(/event: freshness/g) ?? []).length;
  const shortLived = await call(`/api/agents/${agent.id}/commands`, { method: "POST", headers: { "Idempotency-Key": "second-task" }, body: JSON.stringify({ text: "Another job" }) });
  assert.equal(shortLived.status, 202);
  const another = await until(async () => (await call("/api/tasks")).body.tasks.find((candidate) => candidate.localId !== taskId && candidate.state === "TASK_STATE_INPUT_REQUIRED"), "second task");
  const brief = await call("/api/decisions", { method: "POST", body: JSON.stringify({ ...open, taskId: another.localId, requestKey: "brief",
    expiresAt: new Date(Date.now() + 2000).toISOString() }) });
  assert.equal(brief.status, 201, brief.text);
  await until(() => (frames.match(/event: freshness/g) ?? []).length > baseline, "freshness signal after opening a request");
  const lapsed = await until(async () => {
    const current = (await call(`/api/decisions/${brief.body.decision.id}`)).body;
    return current.request.status === "expired" ? current : undefined;
  }, "worker expiry");
  assert.equal(lapsed.request.status, "expired");
  const afterExpiry = await call(`/api/decisions/${brief.body.decision.id}/decisions`, { method: "POST", headers: { "Idempotency-Key": "too-late" }, body: JSON.stringify(approve) });
  assert.equal(afterExpiry.status, 409);
  assert.equal(received.filter((message) => message.taskId).length, 1, "An expired request must never reach the agent.");
  assert.ok(!(await call("/api/decisions?status=pending")).body.decisions.some((request) => request.id === brief.body.decision.id));
  live.abort();

  // The audit trail alone says who decided exactly what, when and why, and it can only be read, never changed.
  const trail = (await call("/api/audit?limit=200")).body;
  const approvalEntry = trail.entries.find((entry) => entry.kind === "decision.edit" && entry.subjectId === id);
  assert.ok(approvalEntry, "The edited approval is in the audit trail.");
  assert.equal(trail.people[approvalEntry.actorUserId], "Local operator");
  assert.equal(approvalEntry.data.text, "Yes, delete staging but keep backups");
  assert.equal(approvalEntry.data.rationale, "Keep backups");
  assert.equal(approvalEntry.data.digest, detail.revisions[1].digest);
  assert.equal(approvalEntry.data.revision, 2);
  assert.equal(approvalEntry.data.messageId, `decision-${decisionId}`);
  assert.equal(approvalEntry.taskId, taskId);
  const expiredEntry = trail.entries.find((entry) => entry.kind === "decision.expired" && entry.subjectId === brief.body.decision.id);
  assert.ok(expiredEntry && expiredEntry.actorUserId === null, "The worker's expiry is recorded as the system.");
  assert.ok(trail.entries.some((entry) => entry.kind === "decision.requested" && entry.subjectId === id));
  assert.ok(trail.entries.every((entry, index, all) => index === 0 || all[index - 1].at >= entry.at), "Newest first.");
  const walked = []; let cursor = "";
  do { const next = (await call(`/api/audit?limit=3${cursor ? `&cursor=${cursor}` : ""}`)).body; walked.push(...next.entries); cursor = next.next ?? ""; } while (cursor);
  assert.deepEqual(walked.map((entry) => entry.key), trail.entries.map((entry) => entry.key), "Paging neither skips nor repeats entries.");
  assert.ok((await call("/api/audit?group=approvals")).body.entries.every((entry) => entry.kind.startsWith("decision.")));
  assert.ok((await call(`/api/audit?taskId=${taskId}`)).body.entries.every((entry) => entry.taskId === taskId));
  assert.equal((await call("/api/audit?group=bogus")).status, 400);
  assert.equal((await call("/api/audit?taskId=nope")).status, 400);
  assert.equal((await call(`/api/audit?taskId=00000000-0000-4000-a000-000000000000`)).status, 404);
  const csv = await fetch(`${base}/api/audit/export?group=approvals`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-disposition"), /attachment/);
  assert.equal(csv.headers.get("x-content-type-options"), "nosniff");
  assert.ok((await csv.text()).startsWith("time,kind,actor,task,subject,detail\r\n"));
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) assert.ok([404, 405].includes((await call("/api/audit", { method, body: "{}" })).status), `${method} must not exist on the trail`);

  // Structured reply (ADR 0015 addendum): values for a pinned form are validated, edited by a reviewer, and sent as one JSON part
  // that carries the approved revision's identity.
  const third = await call(`/api/agents/${agent.id}/commands`, { method: "POST", headers: { "Idempotency-Key": "third-task" }, body: JSON.stringify({ text: "Third job" }) });
  assert.equal(third.status, 202);
  const thirdTask = await until(async () => (await call("/api/tasks")).body.tasks.find((candidate) => candidate.taskId === "approval-task-3" && candidate.state === "TASK_STATE_INPUT_REQUIRED"), "third task");
  const deployForm = { title: "Deploy request", order: ["environment", "replicas"], schema: { type: "object", required: ["environment", "replicas"], properties: {
    environment: { type: "string", title: "Environment", enum: ["staging", "production"] }, replicas: { type: "integer", minimum: 1, maximum: 10 } } } };
  const structuredOpen = { taskId: thirdTask.localId, requestKey: "structured", title: "Approve deploy", summary: "Agent asked for deployment parameters", risk: "high",
    action: { kind: "send_data", form: deployForm, values: { environment: "staging", replicas: 2 } }, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), policy: { separationOfDuties: false } };
  assert.equal((await call("/api/decisions", { method: "POST", body: JSON.stringify({ ...structuredOpen, requestKey: "bad", action: { ...structuredOpen.action, values: { environment: "staging", replicas: 99 } } }) })).status, 400);
  assert.equal((await call("/api/decisions", { method: "POST", body: JSON.stringify({ ...structuredOpen, requestKey: "extra", action: { ...structuredOpen.action, values: { environment: "staging", replicas: 2, sneaky: 1 } } }) })).status, 400);
  const structuredCreated = await call("/api/decisions", { method: "POST", body: JSON.stringify(structuredOpen) });
  assert.equal(structuredCreated.status, 201, structuredCreated.text);
  assert.equal(structuredCreated.body.decision.kind, "send_data");
  const sid = structuredCreated.body.decision.id;
  const sBefore = received.length;
  const sDecide = `/api/decisions/${sid}/decisions`;
  assert.equal((await call(sDecide, { method: "POST", headers: { "Idempotency-Key": "form-edit" }, body: JSON.stringify({ outcome: "edit", expectedRevision: 1, rationale: "x",
    edit: { kind: "send_data", form: { ...deployForm, title: "Changed" }, values: { environment: "staging", replicas: 3 } } }) })).status, 422, "A reviewer cannot change the form");
  assert.equal(received.length, sBefore, "Refused edits send nothing");
  const sApproved = await call(sDecide, { method: "POST", headers: { "Idempotency-Key": "structured-edit" }, body: JSON.stringify({ outcome: "edit", expectedRevision: 1, rationale: "Production with fewer replicas",
    edit: { kind: "send_data", form: deployForm, values: { environment: "production", replicas: 3 } } }) });
  assert.equal(sApproved.status, 201, sApproved.text);
  const sDetail = await until(async () => { const current = (await call(`/api/decisions/${sid}`)).body; return current?.executions?.[0]?.status === "succeeded" ? current : undefined; }, "structured execution");
  const sMessage = received.slice(sBefore).find((message) => message.taskId === "approval-task-3");
  assert.ok(sMessage, "The structured approval reached the agent");
  assert.equal(received.slice(sBefore).filter((message) => message.taskId === "approval-task-3").length, 1);
  assert.deepEqual(sMessage.parts, [{ data: { environment: "production", replicas: 3 }, mediaType: "application/json" }], "Exactly one JSON data part, not text");
  assert.deepEqual(sMessage.metadata.approval, { requestId: sid, decisionId: sApproved.body.decision.id, revision: 2, revisionDigest: sDetail.revisions[1].digest });
  assert.equal(sDetail.decisions[0].revisionDigest, sDetail.revisions[1].digest);

  // Malformed and unknown identifiers are indistinguishable from absent requests.
  assert.equal((await call("/api/decisions/not-a-uuid")).status, 404);
  assert.equal((await call("/api/decisions/00000000-0000-4000-a000-000000000000")).status, 404);
  console.log("Decision HTTP verification passed.");
} finally {
  await stop().catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
}
