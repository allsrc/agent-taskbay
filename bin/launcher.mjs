// Pure launcher logic for `npx agent-taskbay` (ADR 0025). The entry point in agent-taskbay.mjs does the I/O.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const DEFAULT_PORT = 3002;
export const DEFAULT_HOST = "127.0.0.1";

export const HELP = `Agent Taskbay: the human operations console for A2A agent workflows.

Usage:
  agent-taskbay [start] [options]   Start the console (default command)
  agent-taskbay demo-agent [port]   Serve sample A2A agents to try the console with
  agent-taskbay --version | --help

Options for start:
  -p, --port <number>     Port to listen on (default ${DEFAULT_PORT}, or $PORT)
  -H, --host <address>    Address to bind (default ${DEFAULT_HOST})
      --data-dir <path>   Database, artifacts and generated secrets
                          (default ~/.agent-taskbay, or $A2A_DATA_DIR)
      --no-open           Do not open a browser tab
      --open              Open a browser tab even when not attached to a terminal

Local mode signs you in as a development administrator, so it only binds to a loopback address.
To listen on another address, configure OIDC (see https://github.com/allsrc/agent-taskbay#user-identity-and-sign-in).
Every A2A_* setting in .env.example may be supplied through the environment.
`;

export class UsageError extends Error {}

const COMMANDS = new Set(["start", "demo-agent", "help", "version"]);

export function parseArgs(argv) {
  const options = { open: undefined };
  const positional = [];
  const args = [...argv];
  const take = (flag) => {
    const value = args.shift();
    if (value === undefined || value.startsWith("-")) throw new UsageError(`${flag} needs a value.`);
    return value;
  };
  while (args.length) {
    const arg = args.shift();
    if (arg === "-h" || arg === "--help") return { command: "help", options, positional };
    if (arg === "-v" || arg === "--version") return { command: "version", options, positional };
    if (arg === "-p" || arg === "--port") options.port = parsePort(take(arg));
    else if (arg.startsWith("--port=")) options.port = parsePort(arg.slice(7));
    else if (arg === "-H" || arg === "--host") options.host = take(arg);
    else if (arg.startsWith("--host=")) options.host = arg.slice(7);
    else if (arg === "--data-dir") options.dataDir = take(arg);
    else if (arg.startsWith("--data-dir=")) options.dataDir = arg.slice(11);
    else if (arg === "--no-open") options.open = false;
    else if (arg === "--open") options.open = true;
    else if (arg.startsWith("-")) throw new UsageError(`Unknown option ${arg}.`);
    else positional.push(arg);
  }
  const command = positional[0] && COMMANDS.has(positional[0]) ? positional.shift() : "start";
  if (command === "start" && positional.length) throw new UsageError(`Unexpected argument ${positional[0]}.`);
  return { command, options, positional };
}

export function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UsageError(`"${value}" is not a valid port.`);
  return port;
}

export function isLoopbackHost(host) {
  const value = host.replace(/^\[|\]$/g, "").toLowerCase();
  return value === "localhost" || value === "::1" || /^127(\.\d{1,3}){3}$/.test(value);
}

export function resolveDataDir(options, env = process.env) {
  return resolve(options.dataDir ?? (env.A2A_DATA_DIR || join(homedir(), ".agent-taskbay")));
}

const HEX_KEY = /^[0-9a-f]{64}$/i;

/** Generated once and kept next to the database. Mode 0600; never printed and never sent to the browser. */
export function loadOrCreateSecrets(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, "secrets.json");
  if (!existsSync(file)) {
    const secrets = { vaultKeys: { "local-1": randomBytes(32).toString("hex") }, vaultActiveKey: "local-1" };
    writeFileSync(file, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    return secrets;
  }
  try { chmodSync(file, 0o600); } catch { /* Windows and some mounts ignore POSIX modes. */ }
  let secrets;
  try { secrets = JSON.parse(readFileSync(file, "utf8")); } catch { secrets = undefined; }
  const valid = secrets && typeof secrets.vaultActiveKey === "string" && secrets.vaultKeys && typeof secrets.vaultKeys === "object" &&
    HEX_KEY.test(secrets.vaultKeys[secrets.vaultActiveKey] ?? "");
  // Never overwrite: replacing the vault key would make every stored agent credential unreadable.
  if (!valid) throw new UsageError(`${file} is not valid. Fix or remove it. Removing it makes stored agent credentials unreadable.`);
  return secrets;
}

export function usesOidc(env) {
  return env.A2A_AUTH_MODE === "oidc" || Boolean(env.A2A_OIDC_ISSUER);
}

/** Environment for the Next.js server. Values the operator already set always win. */
export function buildEnvironment({ env, port, host, dataDir, secrets }) {
  const oidc = usesOidc(env);
  if (!oidc && !isLoopbackHost(host)) {
    throw new UsageError(
      `Local mode signs everyone in as an administrator, so it cannot listen on ${host}. ` +
      "Use 127.0.0.1, or configure OIDC (A2A_AUTH_MODE=oidc and the A2A_OIDC_* settings).");
  }
  const postgres = env.A2A_DATABASE_PROFILE === "postgresql";
  const child = {
    ...env,
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: host,
    A2A_DATA_DIR: env.A2A_DATA_DIR || dataDir,
    A2A_ARTIFACT_DATA_DIR: env.A2A_ARTIFACT_DATA_DIR || join(dataDir, "artifacts"),
  };
  if (!postgres) {
    child.A2A_PGLITE_DATA_DIR = env.A2A_PGLITE_DATA_DIR || join(dataDir, "pglite");
    child.A2A_AUTO_MIGRATE = env.A2A_AUTO_MIGRATE || "true";
  }
  if (!env.A2A_VAULT_KEYS) {
    child.A2A_VAULT_KEYS = JSON.stringify(secrets.vaultKeys);
    child.A2A_VAULT_ACTIVE_KEY = secrets.vaultActiveKey;
  }
  if (!oidc) {
    child.A2A_AUTH_MODE = "development";
    child.A2A_ALLOW_DEVELOPMENT_AUTH = "true";
    child.A2A_ALLOW_PRIVATE_NETWORKS = env.A2A_ALLOW_PRIVATE_NETWORKS || "true";
  }
  return child;
}

/** A host that clients on this machine can actually connect to. */
export function connectHost(host) {
  const value = host.replace(/^\[|\]$/g, "");
  if (value === "0.0.0.0" || value === "::") return "127.0.0.1";
  return value.includes(":") ? `[${value}]` : value;
}
