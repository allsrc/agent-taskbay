#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DEFAULT_HOST, DEFAULT_PORT, HELP, UsageError, buildEnvironment, connectHost, isLoopbackHost, loadOrCreateSecrets,
  parseArgs, parsePort, resolveDataDir, usesOidc,
} from "./launcher.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

function fail(message) {
  console.error(`agent-taskbay: ${message}`);
  process.exit(1);
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

/** PGlite has a single owner, so a second launch on the same data directory fails with an obscure database error. */
function claimDataDir(dataDir, details) {
  const file = join(dataDir, "agent-taskbay.pid");
  if (existsSync(file)) {
    try {
      const running = JSON.parse(readFileSync(file, "utf8"));
      if (running.pid && running.pid !== process.pid && processAlive(running.pid)) {
        throw new UsageError(`Agent Taskbay is already running for ${dataDir} (pid ${running.pid}, ${running.url}). Stop it first or use --data-dir.`);
      }
    } catch (error) {
      if (error instanceof UsageError) throw error;
    }
  }
  writeFileSync(file, `${JSON.stringify({ pid: process.pid, ...details })}\n`);
  return () => { try { rmSync(file); } catch { /* already gone */ } };
}

async function waitUntilReady(url, child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`${url}/api/auth/session`, { signal: AbortSignal.timeout(2000) });
      await response.body?.cancel();
      if (response.status < 500) return true;
    } catch { /* not listening yet */ }
    await new Promise((done) => setTimeout(done, 400));
  }
  return false;
}

function openBrowser(url) {
  const [command, args] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const opener = spawn(command, args, { stdio: "ignore", detached: true });
    opener.on("error", () => undefined);
    opener.unref();
  } catch { /* a missing opener is not an error */ }
}

async function start(options) {
  const port = options.port ?? (process.env.PORT ? parsePort(process.env.PORT) : DEFAULT_PORT);
  const host = options.host ?? DEFAULT_HOST;
  const dataDir = resolveDataDir(options);
  if (!existsSync(join(packageRoot, ".next", "BUILD_ID"))) {
    throw new UsageError("There is no production build. In a git checkout run `npm run build` first; the published package ships one.");
  }
  const secrets = loadOrCreateSecrets(dataDir);
  const env = buildEnvironment({ env: process.env, port, host, dataDir, secrets });
  const url = `http://${connectHost(host)}:${port}`;
  const release = claimDataDir(dataDir, { port, host, url, startedAt: new Date().toISOString() });
  mkdirSync(env.A2A_ARTIFACT_DATA_DIR, { recursive: true });

  const nextBin = createRequire(join(packageRoot, "package.json")).resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port), "-H", host], {
    cwd: packageRoot, env, stdio: ["ignore", "inherit", "inherit"],
  });
  let stopping = false;
  const stop = (signal) => { stopping = true; if (child.exitCode === null) child.kill(signal); };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  child.on("error", (error) => { release(); fail(`could not start the server: ${error.message}`); });
  child.on("exit", (code, signal) => { release(); process.exit(code ?? (stopping ? 0 : signal ? 1 : 0)); });

  if (await waitUntilReady(url, child)) {
    const local = !usesOidc(process.env);
    console.log(`\n  Agent Taskbay ${version} is running at ${url}`);
    console.log(`  Data: ${dataDir}`);
    if (local) console.log(`  Local mode: you are signed in as a development administrator. ${isLoopbackHost(host) ? "Only this machine can connect." : ""}`);
    console.log("  Try it with sample agents: npx agent-taskbay demo-agent\n");
    if (options.open ?? (process.stdout.isTTY && !process.env.CI)) openBrowser(url);
  }
}

async function demoAgent(positional) {
  const port = positional[0] ? parsePort(positional[0]) : 4010;
  const { startFormAgent } = await import(pathToFileURL(join(packageRoot, "scripts", "fixture-form-agent.mjs")).href);
  const agent = await startFormAgent(port);
  console.log("Sample A2A agents are running. In the console choose Connect agent and paste one of these Agent Card URLs:\n");
  for (const [variant, summary] of [["showcase", "form, A2UI surface and approval request"], ["form", "structured input form"],
    ["approver", "asks a person to approve an action"], ["a2ui", "A2UI confirmation surface"]]) {
    console.log(`  ${agent.cardUrl(variant)}   ${summary}`);
  }
  console.log("\nPress Ctrl+C to stop.");
  const shutdown = () => { void agent.close().finally(() => process.exit(0)); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

try {
  const { command, options, positional } = parseArgs(process.argv.slice(2));
  if (command === "help") console.log(HELP);
  else if (command === "version") console.log(version);
  else if (command === "demo-agent") await demoAgent(positional);
  else await start(options);
} catch (error) {
  if (error instanceof UsageError) fail(error.message);
  throw error;
}
