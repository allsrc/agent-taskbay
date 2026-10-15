import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { startScenarioAgent } from "./fixture-scenario-agent.mjs";

// Real production HTTP: extended cards are validated, stored separately, and displayed without changing the public card.
const directory = await mkdtemp(join(tmpdir(), "a2a-extended-card-http-"));
const port = Number(process.env.A2A_EXTENDED_CARD_HTTP_TEST_PORT ?? 3153);
const base = `http://127.0.0.1:${port}`;
const agent = await startScenarioAgent();
const env = { ...process.env, A2A_ALLOWED_AGENT_ORIGINS: agent.origin, A2A_AUTH_MODE: "development", A2A_ALLOW_DEVELOPMENT_AUTH: "true",
  A2A_COMMAND_WORKER_MODE: "embedded", A2A_DATABASE_PROFILE: "pglite", A2A_PGLITE_DATA_DIR: join(directory, "db"),
  A2A_ARTIFACT_DATA_DIR: join(directory, "artifacts"), A2A_DATA_DIR: directory, A2A_REGISTERED_AGENTS: "", A2A_ALLOW_PRIVATE_NETWORKS: "true" };
delete env.A2A_TASK_DISCOVERY;
let app, log = "";

async function start() {
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env });
  app.stdout.on("data", (data) => { log += data; }); app.stderr.on("data", (data) => { log += data; });
  await until(async () => { try { return (await fetch(base + "/api/auth/session")).ok; } catch { return false; } }, "server ready");
}
async function stopServer() {
  if (app?.exitCode === null) { const exited = new Promise((resolve) => app.once("exit", resolve)); app.kill("SIGTERM"); await exited; }
}
async function call(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { "Content-Type": "application/json", Origin: base, ...options.headers } });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null, text };
}
async function until(check, label, attempts = 300) {
  for (let attempt = 0; attempt < attempts; attempt++) { const value = await check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}\n${log.slice(-3000)}`);
}
const refresh = (agentId) => call(`/api/agents/${agentId}/extended-card/refresh`, { method: "POST" });
const extra = { id: "extra", name: "Extra authenticated skill", description: "Display only", tags: [] };
try {
  await promisify(execFile)(process.execPath, ["node_modules/@mikro-orm/cli/cli.js", "migration:up"], { env });
  await agent.control({ extendedCard: { skills: [extra] } });
  await start();
  const registered = (await call("/api/agents", { method: "POST", body: JSON.stringify({ cardUrl: agent.cardUrl }) })).body.agent;
  const detail = () => call(`/api/agents/${registered.id}`);
  const before = (await detail()).body.card;
  const fetched = await refresh(registered.id);
  assert.equal(fetched.status, 200, fetched.text);
  assert.equal(fetched.headers.get("cache-control"), "no-store");
  assert.deepEqual(fetched.body.skills.map((skill) => skill.id), ["work", "extra"]);
  for (const field of ["supportedInterfaces", "securitySchemes", "signatures", "rawCard"]) assert.equal(fetched.body[field], undefined);
  assert.deepEqual((await detail()).body.card.skills, before.skills);
  const catalog = (await call("/api/agents")).body.agents.find((entry) => entry.id === registered.id);
  assert.deepEqual(catalog.card.skills, before.skills);
  assert.ok(catalog.extendedCard.skills.some((skill) => skill.id === "extra"));
  // Survives a restart, without another fetch from the agent.
  await stopServer(); await start();
  assert.equal((await detail()).body.extendedCard.fetchedAt, fetched.body.fetchedAt);
  // A protocol-level not-configured refusal is a neutral result, preserving the last good snapshot.
  await agent.control({ fail: { method: "GetExtendedAgentCard", error: "ExtendedAgentCardNotConfiguredError", times: 1 } });
  const unavailable = await refresh(registered.id);
  assert.equal(unavailable.status, 200, unavailable.text);
  assert.equal(unavailable.body.available, false);
  // Unsafe, oversized and forged cards are refused; none replaces the last good card.
  for (const extendedCard of [
    { supportedInterfaces: [{ url: "http://169.254.169.254/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" }] },
    { description: "x".repeat(2 * 1024 * 1024) },
    { signatures: [{ protected: "eyJhbGciOiJSUzI1NiIsImtpZCI6ImZvcmdlZCJ9", signature: "bad" }] },
  ]) {
    await agent.control({ extendedCard });
    const refused = await refresh(registered.id);
    assert.equal(refused.status, 502, `${Object.keys(extendedCard).join(",")}: ${refused.text.slice(0, 400)}`);
    assert.equal((await detail()).body.extendedCard.fetchedAt, fetched.body.fetchedAt);
  }
  await agent.control({ extendedCard: null });
  const noCard = await refresh(registered.id);
  assert.equal(noCard.status, 200, noCard.text);
  assert.equal(noCard.body.available, false);
  assert.equal((await refresh("00000000-0000-4000-8000-000000000000")).status, 404);
  let limited;
  for (let attempt = 0; attempt < 35 && !limited; attempt++) {
    const result = await refresh(registered.id);
    if (result.status === 429) limited = result;
  }
  assert.ok(limited, "the database-backed public security budget caps card refreshes");
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.ok(!log.includes("ExtendedAgentCardNotConfiguredError"), "not-configured is not logged as an error");
  console.log("Extended Agent Card HTTP verification passed (pglite).");
} finally {
  await stopServer(); await agent.close(); await rm(directory, { recursive: true, force: true });
}
