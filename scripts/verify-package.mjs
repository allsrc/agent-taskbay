// Exit check for the npm package (ADR 0025, OPS-003): packs the project, installs the tarball into an empty directory exactly as
// `npx agent-taskbay` would, launches it, and drives the real HTTP API. Needs network access to install dependencies.
//   node scripts/verify-package.mjs                      pack (runs the build), install, launch, verify
//   A2A_PACKAGE_TARBALL=/path/agent-taskbay-x.tgz node scripts/verify-package.mjs   reuse an existing tarball
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "taskbay-package-"));
const children = new Set();
const log = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

function launch(args, { env = {}, cwd = work } = {}) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, CI: "true", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const output = { text: "" };
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output.text += chunk; log.push(String(chunk)); });
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  children.add(child);
  return { child, output, exited };
}

async function stop(process_) {
  if (process_.child.exitCode === null) process_.child.kill("SIGTERM");
  await Promise.race([process_.exited, new Promise((resolve) => setTimeout(resolve, 20_000))]);
  if (process_.child.exitCode === null) process_.child.kill("SIGKILL");
  children.delete(process_.child);
}

async function until(description, check, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${description}.\n${log.join("").slice(-4000)}`);
}

async function call(base, path, init = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

try {
  let tarball = process.env.A2A_PACKAGE_TARBALL;
  if (!tarball) {
    execFileSync("npm", ["pack", "--pack-destination", work, "--silent"], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
    tarball = join(work, readdirSync(work).find((name) => name.endsWith(".tgz")));
  }

  // The tarball must hold the build and the launcher, and nothing that belongs to a developer machine.
  const entries = execFileSync("tar", ["-tzf", tarball], { maxBuffer: 256 * 1024 * 1024 }).toString().split("\n").filter(Boolean);
  for (const required of ["package/bin/agent-taskbay.mjs", "package/bin/launcher.mjs", "package/.next/BUILD_ID", "package/next.config.mjs",
    "package/scripts/fixture-form-agent.mjs", "package/LICENSE", "package/README.md"]) assert.ok(entries.includes(required), `tarball is missing ${required}`);
  assert.ok(entries.some((name) => name.startsWith("package/src/server/adapters/db/migrations/Migration")), "tarball has no migrations");
  for (const forbidden of [/^package\/\.next\/cache\//, /^package\/\.next\/dev\//, /^package\/\.env(?!\.example)/, /^package\/\.data\//,
    /\.test\.[mc]?[jt]sx?$/, /^package\/docs\//, /secrets\.json$/, /\.zip$/, /\.rtf$/]) {
    assert.equal(entries.find((name) => forbidden.test(name)), undefined, `tarball must not contain ${forbidden}`);
  }
  console.log(`tarball ok: ${entries.length} files, ${(statSync(tarball).size / 1024 / 1024).toFixed(1)} MiB`);

  // Install as a user would, with production dependencies only.
  const installDir = join(work, "install");
  mkdirSync(installDir);
  execFileSync("npm", ["init", "-y", "--silent"], { cwd: installDir, stdio: "ignore" });
  execFileSync("npm", ["install", tarball, "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: installDir, stdio: "inherit" });
  const bin = join(installDir, "node_modules", "agent-taskbay", "bin", "agent-taskbay.mjs");
  assert.ok(existsSync(bin), "the package did not install its launcher");

  const help = execFileSync(process.execPath, [bin, "--help"]).toString();
  assert.match(help, /Usage:/);
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(execFileSync(process.execPath, [bin, "--version"]).toString().trim(), version);

  const dataDir = join(work, "data");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  // Local mode must refuse to expose the development administrator beyond loopback.
  const refused = launch([bin, "--host", "0.0.0.0", "--data-dir", join(work, "refused"), "--no-open"]);
  assert.notEqual(await refused.exited, 0);
  assert.match(refused.output.text, /cannot listen on 0\.0\.0\.0/);

  let server = launch([bin, "--port", String(port), "--data-dir", dataDir, "--no-open"]);
  await until("the console to answer", async () => { try { return (await fetch(`${base}/api/auth/session`)).status < 500; } catch { return false; } });
  await until("the ready banner", () => /is running at/.test(server.output.text));
  console.log("console started from the installed package");

  // The data directory is single-owner; a second launch must say so instead of failing inside the database.
  const second = launch([bin, "--port", String(await freePort()), "--data-dir", dataDir, "--no-open"]);
  assert.notEqual(await second.exited, 0);
  assert.match(second.output.text, /already running/);

  if (process.platform !== "win32") assert.equal(statSync(join(dataDir, "secrets.json")).mode & 0o777, 0o600);

  // A sample agent, registered through the real API with no origin allowlist configured.
  const demoPort = await freePort();
  const demo = launch([bin, "demo-agent", String(demoPort)]);
  await until("the demo agent", () => /Press Ctrl\+C/.test(demo.output.text));
  const cardUrl = `http://127.0.0.1:${demoPort}/showcase/card.json`;
  const registered = await call(base, "/api/agents", { method: "POST", body: JSON.stringify({ cardUrl }) });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  const agentId = registered.body.agent.id;
  const listed = (await call(base, "/api/agents")).body.agents.find((agent) => agent.id === agentId);
  assert.ok(listed && !listed.error, `agent discovery failed: ${listed?.error}`);

  // The packaged build runs its embedded workers: a command is dispatched and a durable task appears.
  const accepted = await call(base, `/api/agents/${agentId}/commands`, {
    method: "POST", headers: { "Idempotency-Key": "package-smoke-1" }, body: JSON.stringify({ text: "hello from the package check" }),
  });
  assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
  const commandId = accepted.body.command.id;
  const command = await until("the command to succeed", async () => {
    const current = (await call(base, `/api/commands/${commandId}`)).body.command;
    if (current.status === "failed") throw new Error(`command failed: ${current.error}`);
    return current.status === "succeeded" ? current : undefined;
  });
  const taskId = command.result.localId;
  assert.ok(taskId, "the command produced no durable task");
  assert.equal((await call(base, `/api/tasks/${taskId}`)).status, 200);

  // Restart: migrations are idempotent, the vault key is reused and nothing is lost.
  await stop(server);
  assert.equal(existsSync(join(dataDir, "agent-taskbay.pid")), false, "the pid file was not released");
  server = launch([bin, "--port", String(port), "--data-dir", dataDir, "--no-open"]);
  await until("the console after restart", async () => { try { return (await fetch(`${base}/api/auth/session`)).status < 500; } catch { return false; } });
  assert.ok((await call(base, "/api/agents")).body.agents.some((agent) => agent.id === agentId), "the agent did not survive a restart");
  assert.equal((await call(base, `/api/tasks/${taskId}`)).status, 200, "the task did not survive a restart");

  await stop(server);
  await stop(demo);
  console.log("package verified: tarball contents, install, launch, auth guard, data-dir guard, agent registration, command dispatch, restart");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill("SIGKILL");
  rmSync(work, { recursive: true, force: true });
}
