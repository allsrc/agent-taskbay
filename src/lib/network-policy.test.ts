import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
const resolver = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({lookup: resolver}));
import { createSafeFetch, MAX_AGENT_RESPONSE_BYTES } from "./safe-fetch";
afterEach(() => {vi.unstubAllEnvs();resolver.mockReset();});
it("rejects DNS rebinding at the socket even after a public preflight; no request or auth reaches the private target", async () => {
  let requests = 0;
  const server = createServer((_req,res) => {requests++;res.end("private");});
  await new Promise<void>((resolve) => server.listen(0,"127.0.0.1",resolve));
  try {
    vi.stubEnv("NODE_ENV", "test");vi.stubEnv("A2A_ALLOWED_AGENT_ORIGINS", "");vi.stubEnv("A2A_ALLOW_PRIVATE_NETWORKS", "false");
    resolver.mockResolvedValueOnce([{address: "8.8.8.8", family: 4}]).mockResolvedValue([{address: "127.0.0.1", family: 4}]);
    const port = (server.address() as {port: number}).port;
    const safeFetch = createSafeFetch({auth: {type: "bearer", token: "private-token"}, headers: {}, telemetry: [], timeoutMs: 2000});
    await expect(safeFetch(`http://rebind.test:${port}/card`)).rejects.toThrow();
    expect(resolver).toHaveBeenCalledTimes(2);expect(requests).toBe(0);
  } finally {server.closeAllConnections();await new Promise<void>((resolve) => server.close(() => resolve()));}
});
it("enforces actual streamed size without a Content-Length header", async () => {
  const server = createServer((_req,res) => {
    res.writeHead(200, {"Content-Type": "application/octet-stream"});
    const block = Buffer.alloc(1024 * 1024);
    for (let offset = 0; offset <= MAX_AGENT_RESPONSE_BYTES; offset += block.length) res.write(block);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0,"127.0.0.1",resolve));
  try {
    vi.stubEnv("NODE_ENV", "test");vi.stubEnv("A2A_ALLOWED_AGENT_ORIGINS", "");vi.stubEnv("A2A_ALLOW_PRIVATE_NETWORKS", "true");
    const port = (server.address() as {port: number}).port;
    const response = await createSafeFetch({auth: {type: "none"}, headers: {}, telemetry: [], timeoutMs: 5000})(`http://127.0.0.1:${port}/data`);
    await expect(response.arrayBuffer()).rejects.toThrow("safety limit");
  } finally {server.closeAllConnections();await new Promise<void>((resolve) => server.close(() => resolve()));}
});
