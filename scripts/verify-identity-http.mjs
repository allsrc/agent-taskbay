import { EncryptedDatabaseCredentialVault } from "../src/server/adapters/db/credential-vault.ts";
import { createGrant } from "../src/server/adapters/db/security-repository.ts";
import assert from "node:assert/strict";
import { createServer as createHttpsServer } from "node:https";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import pg from "pg";
import { createDatabaseOrm } from "../src/server/adapters/db/orm.ts";
import { createPersistenceRepositories } from "../src/server/adapters/db/repositories.ts";
import { provisionIdentity, DatabaseIdentityRepository } from "../src/server/adapters/db/identity-repository.ts";
import { MembershipEntity, SecurityAuditEntity, UserSessionEntity, LoginAttemptEntity } from "../src/server/adapters/db/entities.ts";
import { DatabaseAgentRegistry } from "../src/server/adapters/db/agent-registry.ts";
import { withPrincipal } from "../src/server/adapters/auth/principal-context.ts";
import { createTaskObserver } from "../src/server/runtime/task-persistence.ts";
import { FilesystemArtifactStore } from "../src/server/adapters/blob/filesystem-artifact-store.ts";
import { opaqueToken, tokenHash } from "../src/server/adapters/auth/oidc.ts";

// SEC-001/004: real TLS OIDC issuer, signed tokens and production Next HTTP.
const directory = await mkdtemp(join(tmpdir(), "a2a-identity-http-"));
const port = Number(process.env.A2A_IDENTITY_HTTP_TEST_PORT ?? 3104);
const base = `http://127.0.0.1:${port}`;
const origin = "https://console.example.test";
const agentBearer = "server-only-agent-bearer-private";
const clientSecret = "server-only-oidc-client-secret";
const accessToken = "fixture-access-token-never-browser";
const refreshToken = "fixture-refresh-token-never-browser";
const env = { ...process.env, A2A_AUTH_MODE: "oidc", A2A_ALLOW_DEVELOPMENT_AUTH: "false", A2A_AUTH_ORIGIN: origin,
  A2A_OIDC_CLIENT_ID: "console", A2A_OIDC_CLIENT_SECRET: clientSecret, A2A_AUTH_FLOW_KEY: "cd".repeat(32), A2A_AUTH_ORGANIZATION_SLUG: "org-a",
  A2A_DATABASE_PROFILE: "pglite", A2A_PGLITE_DATA_DIR: join(directory, "db"), A2A_ARTIFACT_DATA_DIR: join(directory, "artifacts"),
  A2A_DATA_DIR: directory, A2A_REGISTERED_AGENTS: "", A2A_COMMAND_WORKER_MODE: "embedded", A2A_ALLOW_PRIVATE_NETWORKS: "true",
  A2A_PUSH_CALLBACK_ORIGIN: "", A2A_PUSH_SIGNING_KEY: "", A2A_VAULT_KEYS: JSON.stringify({current: "ab".repeat(32)}), A2A_VAULT_ACTIVE_KEY: "current" };
let config = { profile: "pglite", dataDir: env.A2A_PGLITE_DATA_DIR };
let adminDb, testDatabase;
let app, log = "", oidcServer, agentServer;
let sends = 0;
let issuer;
const codes = new Map();
const grants = new Map();
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...await exportJWK(publicKey), alg: "RS256", kid: "fixture" };
const cookie = (response, name) => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0];
function noSecrets(text) { for (const value of [clientSecret, accessToken, refreshToken, agentBearer]) assert.ok(!text.includes(value), "Secret reached a browser response/log/storage"); }
async function stop() {
  if (app?.exitCode === null) {
    const exited = new Promise((resolve) => app.once("exit", resolve)); app.kill("SIGTERM"); await exited;
  }
}
async function start(overrides = {}) {
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env: { ...env, ...overrides } });
  app.stdout.on("data", (data) => { log += data; }); app.stderr.on("data", (data) => { log += data; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (app.exitCode !== null) throw new Error(log);
    try { await fetch(base + "/api/auth/session"); return; } catch { /* Socket not ready. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Identity HTTP server not ready.");
}
async function request(path, session, options = {}) {
  const response = await fetch(base + path, { ...options, redirect: "manual",
    headers: { ...(session ? { Cookie: session } : {}), ...options.headers } });
  return response;
}
async function json(path, session, options = {}) {
  const response = await request(path, session, options); const text = await response.text(); noSecrets(text);
  assert.equal(response.status, options.status ?? 200, text); return JSON.parse(text);
}
async function login(subject, returnTo = "/tasks", badState = false) {
  const begin = await request(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  assert.equal(begin.status, 303);
  const flowCookie = cookie(begin, "__Host-a2a-login"); assert.ok(flowCookie);
  const attributes = begin.headers.get("set-cookie");
  assert.match(attributes, /HttpOnly/); assert.match(attributes, /Secure/); assert.match(attributes, /SameSite=lax/i);
  const authorize = new URL(begin.headers.get("location"));
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  const code = opaqueToken(); codes.set(code, { subject, nonce: authorize.searchParams.get("nonce"), challenge: authorize.searchParams.get("code_challenge") });
  const callback = `/api/auth/callback?code=${code}&state=${badState ? "wrong" : authorize.searchParams.get("state")}`;
  const response = await request(callback, flowCookie);
  return { response, callback, flowCookie, session: cookie(response, "__Host-a2a-session") };
}
try {
  if (process.env.A2A_IDENTITY_HTTP_TEST_PROFILE === "postgresql") {
    const url = new URL(process.env.A2A_TEST_POSTGRES_URL);
    if (!decodeURIComponent(url.pathname).includes("test")) throw new Error("Use a PostgreSQL test database.");
    adminDb = new pg.Client({ connectionString: url.toString() }); await adminDb.connect();
    testDatabase = `a2a_identity_http_test_${randomUUID().replaceAll("-", "")}`;
    await adminDb.query(`create database "${testDatabase}"`); url.pathname = "/" + testDatabase;
    config = { profile: "postgresql", url: url.toString() }; env.A2A_DATABASE_PROFILE = "postgresql"; env.A2A_DATABASE_URL = config.url;
  }
  const keyPath = join(directory, "key.pem"), certPath = join(directory, "cert.pem");
  await promisify(execFile)("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1", "-days", "1", "-keyout", keyPath, "-out", certPath]);
  env.NODE_EXTRA_CA_CERTS = certPath;
  oidcServer = createHttpsServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.includes(".well-known")) return res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"] }));
    if (req.url === "/jwks") return res.end(JSON.stringify({ keys: [jwk] }));
    assert.equal(req.url, "/token"); let body = ""; for await (const chunk of req) body += chunk;
    const params = new URLSearchParams(body); const code = params.get("code"), grant = codes.get(code); codes.delete(code);
    if (!grant) { res.statusCode = 400; return res.end(JSON.stringify({ error: "invalid_grant" })); }
    assert.equal(params.get("client_secret"), clientSecret); assert.equal(params.get("redirect_uri"), `${origin}/api/auth/callback`);
    assert.equal(createHash("sha256").update(params.get("code_verifier")).digest("base64url"), grant.challenge);
    const idToken = await new SignJWT({ nonce: grant.nonce, role: "admin", organizationId: "untrusted-provider-org" })
      .setProtectedHeader({ alg: "RS256", kid: "fixture" }).setIssuer(issuer).setAudience("console").setSubject(grant.subject).setIssuedAt().setExpirationTime("5m").sign(privateKey);
    res.end(JSON.stringify({ token_type: "Bearer", access_token: accessToken, refresh_token: refreshToken, id_token: idToken }));
  });
  await new Promise((resolve) => oidcServer.listen(0, "127.0.0.1", resolve)); issuer = `https://127.0.0.1:${oidcServer.address().port}`; env.A2A_OIDC_ISSUER = issuer;
  agentServer = createHttpsServer({key: await readFile(keyPath), cert: await readFile(certPath)}, async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== `Bearer ${agentBearer}`) { res.statusCode = 401; return res.end(JSON.stringify({error: "Credentials required"})); }
    if (req.method === "GET") return res.end(JSON.stringify({ name: "Protected catalog fixture", version: "1", supportedInterfaces: [{ url: `https://127.0.0.1:${agentServer.address().port}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }], capabilities: {}, defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain"], skills: [] }));
    let body = ""; for await (const chunk of req) body += chunk; const rpc = JSON.parse(body);
    if (["ListTasks", "GetTask"].includes(rpc.method)) return res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Fixture read unsupported" } }));
    assert.equal(rpc.method, "SendMessage"); sends++;
    res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { message: { messageId: "response", role: "ROLE_AGENT", parts: [{ text: `Durable authenticated answer ${agentBearer}` }] } } }));
  });
  await new Promise((resolve) => agentServer.listen(0, "127.0.0.1", resolve));
  env.A2A_ALLOWED_AGENT_ORIGINS = `https://127.0.0.1:${agentServer.address().port}`;
  let orm = await createDatabaseOrm(config);
  let agent, privateView, digest, foreignToken = opaqueToken();
  try {
    await orm.migrator.up();
    for (const slug of ["org-a", "org-b"]) {
      const now = new Date(); const org = await createPersistenceRepositories(orm.em.fork()).organizations.getOrCreate({ id: randomUUID(), slug, name: slug, createdAt: now, updatedAt: now });
      for (const role of slug === "org-a" ? ["admin", "operator", "viewer", "ungranted"] : ["operator"]) {
        const principal = await provisionIdentity(orm.em.fork(), { issuer, subject: `${slug}-${role}`, organizationId: org.id, displayName: `${slug} ${role}`, role: role === "ungranted" ? "operator" : role }); grants.set(`${slug}-${role}`, principal);
      }
    }
    const registry = new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    agent = await withPrincipal(grants.get("org-a-admin"), () => registry.add(`https://127.0.0.1:${agentServer.address().port}/card`));
    const store = new FilesystemArtifactStore(env.A2A_ARTIFACT_DATA_DIR);
    Object.assign(process.env, {A2A_VAULT_KEYS: env.A2A_VAULT_KEYS, A2A_VAULT_ACTIVE_KEY: env.A2A_VAULT_ACTIVE_KEY});
    await new EncryptedDatabaseCredentialVault(orm.em.fork()).store(grants.get("org-a-admin").organizationId, agent.id,
      {origins: [env.A2A_ALLOWED_AGENT_ORIGINS], credential: {type: "bearer", token: agentBearer}});
    for (const role of ["operator", "viewer"]) await orm.em.fork().transactional((tx) => createGrant(tx, grants.get("org-a-admin"),
      {subjectType: "membership", subjectId: grants.get(`org-a-${role}`).membershipId, agentId: agent.id, skillId: null, permission: role === "viewer" ? "read" : "operate"}));
    privateView = await createTaskObserver({ organizationId: grants.get("org-a-admin").organizationId, agentId: agent.id,
      sessionId: randomUUID(), requestId: randomUUID() }, { orm, store, manageSubscription: false, managePush: false })({ task: { id: "private-task", status: { state: "TASK_STATE_COMPLETED" },
        history: [{ messageId: "private-message", role: "ROLE_AGENT", parts: [{ text: "private-org-a" }] }], artifacts: [{ artifactId: "private-binary", parts: [{ raw: "cHJpdmF0ZQ==" }] }] } });
    digest = (await store.put(grants.get("org-a-admin").organizationId, Buffer.from("private"))).digest;
    await new DatabaseIdentityRepository(orm.em.fork()).createSession(tokenHash(foreignToken), grants.get("org-b-operator"), new Date(Date.now() + 300_000));
  } finally { await orm.close(true); }
  await start({ A2A_AUTH_MODE: "", A2A_OIDC_ISSUER: "" });
  assert.equal((await request("/api/tasks")).status, 503); await stop();
  await start();
  const publicRoutes = ["/api/agents", `/api/agents/${agent.id}`, "/api/tasks", `/api/tasks/${privateView.localId}`, "/api/task-views", "/api/tasks/events", `/api/artifacts/${digest}`, `/api/commands/${randomUUID()}`, "/api/auth/session", "/api/notifications", "/api/notifications/channel", "/api/audit", "/api/decisions", "/api/escalation-policies"];
  for (const path of publicRoutes) assert.equal((await request(path)).status, 401, path);
  for (const path of ["/api/agents", "/api/agents/preview", `/api/agents/${agent.id}/commands`, `/api/agents/${agent.id}/messages`, `/api/agents/${agent.id}/stream`, `/api/agents/${agent.id}/tasks/private-task/cancel`]) {
    assert.equal((await request(path, undefined, { method: "POST" })).status, 401, path);
  }
  const signedIn = await login("org-a-admin", "//evil.test"); assert.equal(signedIn.response.status, 303); assert.equal(signedIn.response.headers.get("location"), `${origin}/tasks`);
  assert.ok(signedIn.session); noSecrets(signedIn.session);
  const adminSession = signedIn.session;
  assert.equal((await request(signedIn.callback, signedIn.flowCookie)).status, 401, "Callback replay succeeded");
  assert.equal((await login("org-a-admin", "/tasks", true)).response.status, 401);
  assert.equal((await login("not-provisioned")).response.status, 401);
  assert.equal((await json("/api/auth/session", adminSession)).user.role, "admin");
  assert.equal((await json(`/api/tasks/${privateView.localId}?organizationId=foreign`, adminSession)).task.taskId, "private-task");
  assert.equal(await (await request(`/api/artifacts/${digest}`, adminSession)).text(), "private");
  const foreignSession = `__Host-a2a-session=${foreignToken}`;
  assert.equal((await request(`/api/tasks/${privateView.localId}`, foreignSession)).status, 404);
  assert.equal((await request(`/api/artifacts/${digest}`, foreignSession)).status, 404);
  assert.equal((await request(`/api/agents/${agent.id}`, foreignSession)).status, 404);
  assert.deepEqual((await json("/api/task-views?organizationId=org-a", foreignSession, { headers: { "X-Organization-Id": grants.get("org-a-admin").organizationId } })).tasks, []);
  const viewerSession = (await login("org-a-viewer")).session;
  assert.equal((await json("/api/auth/session", viewerSession)).user.role, "viewer", "IdP role claim escalated a provisioned viewer");
  assert.equal((await request(`/api/agents/${agent.id}/commands`, viewerSession, { method: "POST", headers: { Origin: origin } })).status, 403);
  assert.equal((await request(`/api/agents/${agent.id}`, viewerSession, { method: "DELETE", headers: { Origin: origin } })).status, 403);
  const ungrantedSession = (await login("org-a-ungranted")).session;
  assert.deepEqual((await json("/api/agents", ungrantedSession)).agents, []);
  for (const path of [`/api/agents/${agent.id}`, `/api/tasks/${privateView.localId}`, `/api/artifacts/${digest}`])
    assert.equal((await request(path, ungrantedSession)).status, 404);
  for (const path of [`/api/agents/${agent.id}/commands`, `/api/agents/${agent.id}/messages`, `/api/agents/${agent.id}/stream`])
    assert.ok([403, 404].includes((await request(path, ungrantedSession, {method: "POST", headers: {Origin: origin, "Content-Type": "application/json"}, body: JSON.stringify({text: "deny"})})).status));
  const operatorSession = (await login("org-a-operator")).session;
  assert.match(JSON.stringify(await json("/api/agents", operatorSession)), /Protected catalog fixture/);
  await json("/api/admin/security", adminSession);
  assert.equal((await request("/api/admin/security", operatorSession)).status, 403);
  assert.equal((await request("/api/agents", operatorSession, { method: "POST", headers: { Origin: origin } })).status, 403);
  assert.equal((await request("/api/agents", adminSession, { method: "POST", headers: { Origin: "https://evil.test" } })).status, 403);
  assert.equal((await request("/api/agents", adminSession, { method: "POST" })).status, 403);
  const command = (await json(`/api/agents/${agent.id}/commands`, operatorSession, { method: "POST", status: 202,
    headers: { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": "authenticated-command" }, body: JSON.stringify({ text: "Hello" }) })).command;
  for (let attempt = 0; attempt < 100; attempt++) {
    const current = (await json(`/api/commands/${command.id}`, operatorSession)).command;
    if (current.status === "succeeded") break;
    assert.ok(!["failed", "uncertain"].includes(current.status)); await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal((await json(`/api/commands/${command.id}`, operatorSession)).command.status, "succeeded"); assert.equal(sends, 1);
  assert.equal((await request(`/api/commands/${command.id}`, foreignSession)).status, 404);
  // Notifications are personal: every member gets their own inbox, read marks cannot reach anyone else's, and the channel is administrator-only.
  for (const session of [adminSession, operatorSession, viewerSession, ungrantedSession, foreignSession]) {
    const own = await json("/api/notifications", session);
    assert.ok(Array.isArray(own.items) && typeof own.unread === "number");
  }
  for (const session of [operatorSession, viewerSession, ungrantedSession]) {
    assert.equal((await request("/api/notifications/channel", session)).status, 403);
    assert.equal((await request("/api/notifications/test", session, { method: "POST", headers: { Origin: origin } })).status, 403);
  }
  assert.equal((await request("/api/notifications/read", operatorSession, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) })).status, 403, "Mutations need the canonical origin.");
  assert.equal((await json("/api/notifications/read", operatorSession, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ ids: [randomUUID()] }) })).updated, 0);
  assert.equal((await json("/api/notifications/channel", adminSession)).configured, false);
  // Audit trail: administrators read their organization; other members only a task they may read; nobody crosses organizations.
  const trail = await json("/api/audit", adminSession);
  assert.ok(trail.entries.some((entry) => entry.kind === "task.send.accepted" && entry.subjectId === command.id));
  assert.ok(trail.entries.some((entry) => entry.kind === "session.started"));
  assert.equal(trail.viewer.role, "admin");
  for (const session of [operatorSession, viewerSession, ungrantedSession]) {
    assert.equal((await request("/api/audit", session)).status, 403);
    assert.equal((await request("/api/audit/export", session)).status, 403);
  }
  assert.equal((await request(`/api/audit?taskId=${privateView.localId}`, ungrantedSession)).status, 404);
  assert.equal((await request(`/api/audit?taskId=${privateView.localId}`, foreignSession)).status, 404);
  const foreignTrail = await request("/api/audit", foreignSession);
  assert.ok([200, 403].includes(foreignTrail.status));
  if (foreignTrail.status === 200) assert.ok(!(await foreignTrail.text()).includes(command.id), "Another organization's trail leaked");
  assert.equal((await request("/api/audit?limit=0", adminSession)).status, 400);
  assert.equal((await request("/api/audit?cursor=garbage", adminSession)).status, 400);
  const exported = await request("/api/audit/export", adminSession);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-type"), /text\/csv/);
  assert.match(exported.headers.get("content-disposition"), /attachment/);
  noSecrets(await exported.text());
  await stop(); await start();
  assert.equal((await json("/api/auth/session", adminSession)).user.role, "admin", "Session did not survive restart");
  await json("/api/auth/logout", adminSession, { method: "POST", headers: { Origin: origin } });
  assert.equal((await request("/api/tasks", adminSession)).status, 401);
  await stop();
  orm = await createDatabaseOrm(config);
  try {
    const facts = await orm.em.fork().find(SecurityAuditEntity, {}); noSecrets(JSON.stringify(facts));
    assert.equal(facts.filter((event) => event.eventKey === `command:${command.id}`).length, 1);
    assert.ok(facts.some((event) => event.action === "session.ended"));
    noSecrets(JSON.stringify(await orm.em.fork().find(UserSessionEntity, {})));
    noSecrets(JSON.stringify(await orm.em.fork().find(LoginAttemptEntity, {})));
    await orm.em.fork().nativeUpdate(MembershipEntity, { id: grants.get("org-a-operator").membershipId }, { enabled: false });
  } finally { await orm.close(true); }
  await start(); assert.equal((await request("/api/tasks", operatorSession)).status, 401);
  assert.equal((await request("/api/tasks", viewerSession)).status, 200);
  noSecrets(log);
  console.log(`Production HTTP protected vault agent, grants, OIDC/session/membership/organization/artifact/audit disclosure checks passed (${config.profile}).`);
} finally {
  await stop();
  for (const server of [oidcServer, agentServer]) if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  if (adminDb) { try { await adminDb.query(`drop database "${testDatabase}" with (force)`); } finally { await adminDb.end(); } }
  await rm(directory, { recursive: true, force: true });
}
if (process.env.A2A_TEST_POSTGRES_URL && config.profile === "pglite") {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/verify-identity-http.mjs"],
    { env: { ...process.env, A2A_IDENTITY_HTTP_TEST_PROFILE: "postgresql" }, timeout: 120_000 });
  process.stdout.write(stdout); process.stderr.write(stderr);
}
