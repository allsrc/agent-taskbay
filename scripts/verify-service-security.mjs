import assert from "node:assert/strict";
import { createServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Trust the fixture CA at process startup, with normal TLS validation enabled.
if (!process.env.A2A_SERVICE_FIXTURE_DIR) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-service-security-"));
  try {
    await promisify(execFile)("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-days", "1", "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem")]);
    const {stdout, stderr} = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/verify-service-security.mjs"],
      {env: {...process.env, A2A_SERVICE_FIXTURE_DIR: directory, NODE_EXTRA_CA_CERTS: join(directory, "cert.pem")}, timeout: 120_000});
    process.stdout.write(stdout); process.stderr.write(stderr);
  } finally { await rm(directory, {recursive: true, force: true}); }
} else {
  const {connectionForBinding} = await import("../src/server/adapters/a2a/agent-connection.ts");
  const {executeOperation, discoverAgent} = await import("../src/lib/gateway.ts");
  const {createSafeFetch, MAX_AGENT_RESPONSE_BYTES} = await import("../src/lib/safe-fetch.ts");
  const {AgentCard, generateAgentCardSignature} = await import("@a2a-js/sdk");
  const {generateKeyPair, exportJWK} = await import("jose");
  const key = await readFile(join(process.env.A2A_SERVICE_FIXTURE_DIR, "key.pem"), "utf8");
  const cert = await readFile(join(process.env.A2A_SERVICE_FIXTURE_DIR, "cert.pem"), "utf8");
  const apiKey = "fixture-api-key-private", bearer = "fixture-bearer-private", clientSecret = "fixture-client-secret-private", oauthToken = "fixture-oauth-access-private";
  const secrets = [apiKey, bearer, clientSecret, oauthToken, key];
  const {privateKey, publicKey} = await generateKeyPair("RS256");
  let mode = "bearer", agentOrigin, tokenOrigin, card, sends = 0, redirects = 0;
  const tokenServer = createServer({key, cert}, async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const params = new URLSearchParams(body);
    assert.equal(params.get("grant_type"), "client_credentials"); assert.equal(params.get("client_id"), "console");
    assert.equal(params.get("client_secret"), clientSecret); assert.equal(params.get("scope"), "agent:operate");
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({token_type: "Bearer", access_token: oauthToken, expires_in: 60}));
  });
  const agentServer = createServer({key, cert, ca: cert, requestCert: true, rejectUnauthorized: false}, async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    const allowed = mode === "apiKey" ? req.headers["x-agent-key"] === apiKey : mode === "mtls" ? req.socket.authorized : req.headers.authorization === `Bearer ${mode === "oauthClient" ? oauthToken : bearer}`;
    if (!allowed) {res.statusCode = 401; return res.end(JSON.stringify({error: "Credentials required"}));}
    if (req.url === "/redirect") {res.statusCode = 302; res.setHeader("Location", `${tokenOrigin}/steal`); return res.end();}
    if (req.url === "/huge") {res.setHeader("Content-Length", String(MAX_AGENT_RESPONSE_BYTES + 1)); return res.end();}
    if (req.method === "GET") return res.end(JSON.stringify(card));
    let body = ""; for await (const chunk of req) body += chunk; const rpc = JSON.parse(body); assert.equal(rpc.method, "SendMessage"); sends++;
    // Even an authenticated hostile response cannot copy the service secret into archives/wire views.
    const echo = mode === "apiKey" ? apiKey : mode === "mtls" ? key : mode === "oauthClient" ? oauthToken : bearer;
    if (rpc.params?.message?.parts?.[0]?.text === "Fail safely") return res.end(JSON.stringify({jsonrpc: "2.0", id: rpc.id, error: {code: -32000, message: echo}}));
    res.end(JSON.stringify({jsonrpc: "2.0", id: rpc.id, result: {message: {messageId: `answer-${sends}`, role: "ROLE_AGENT", parts: [{text: `Protected answer ${echo}`}], metadata: {echo}}}}));
  });
  const redirectTarget = createHttpServer((req, res) => {redirects++; res.end("leaked");});
  try {
    for (const server of [tokenServer, agentServer, redirectTarget]) await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    agentOrigin = `https://127.0.0.1:${agentServer.address().port}`; tokenOrigin = `https://127.0.0.1:${tokenServer.address().port}`;
    process.env.NODE_ENV = "production"; process.env.A2A_AUTH_MODE = "oidc"; process.env.A2A_ALLOW_PRIVATE_NETWORKS = "true";
    process.env.A2A_ALLOWED_AGENT_ORIGINS = `${agentOrigin},${tokenOrigin}`;
    process.env.A2A_TRUSTED_CARD_KEYS = JSON.stringify([{origin: agentOrigin, kid: "fixture-card", jwk: {...await exportJWK(publicKey), alg: "RS256"}, expiresAt: "2099-01-01T00:00:00Z"}]);
    const signed = await generateAgentCardSignature(privateKey, {alg: "RS256", kid: "fixture-card", typ: "JOSE"})(AgentCard.fromJSON({name: "Protected fixture", version: "1", supportedInterfaces: [{url: `${agentOrigin}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0"}], capabilities: {}, defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain"], skills: []}));
    card = AgentCard.toJSON(signed);
    const credentials = [
      {type: "apiKey", name: "X-Agent-Key", value: apiKey},
      {type: "bearer", token: bearer},
      {type: "oauthClient", issuer: tokenOrigin, tokenEndpoint: `${tokenOrigin}/token`, clientId: "console", clientSecret, scope: "agent:operate"},
      {type: "mtls", cert, key, ca: cert},
    ];
    for (const credential of credentials) {
      mode = credential.type;
      const connection = await connectionForBinding(`${agentOrigin}/card`, {origins: [agentOrigin], credential});
      const discovered = await discoverAgent(connection); assert.equal(discovered.trust, "verified");
      const response = await executeOperation({connection, action: "send", params: {text: "Hello"}});
      assert.match(JSON.stringify(response.result), /Protected answer/);
      for (const secret of secrets) assert.ok(!JSON.stringify(response).includes(secret), "Credential disclosure");
      let failure;
      try {await executeOperation({connection, action: "send", params: {text: "Fail safely"}});} catch (error) {failure = error;}
      assert.ok(failure); assert.equal(failure.envelopeCode, -32000); for (const secret of secrets) assert.ok(!failure.message.includes(secret));
      const fetchImpl = createSafeFetch({...connection, telemetry: [], timeoutMs: 5000});
      await assert.rejects(fetchImpl(`${agentOrigin}/redirect`)); await assert.rejects(fetchImpl(`${agentOrigin}/huge`));
      await assert.rejects(fetchImpl(`${tokenOrigin}/steal`), /destination/);
    }
    assert.equal(sends, 8); assert.equal(redirects, 0);
    card = {...card, name: "Tampered"}; mode = "bearer";
    await assert.rejects(executeOperation({connection: await connectionForBinding(`${agentOrigin}/card`, {origins: [agentOrigin], credential: {type: "bearer", token: bearer}}), action: "send", params: {text: "deny tampered"}}));
    assert.equal(sends, 8);
    console.log("TLS protected SDK agents passed API key, bearer, OAuth client credentials, mTLS, signatures, secret redaction, origin binding, redirect and size gates.");
  } finally {
    for (const server of [agentServer, tokenServer, redirectTarget]) {server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));}
  }
}
