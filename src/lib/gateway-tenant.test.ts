import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverAgent, executeOperation, streamOperation } from "./gateway";
import { buildConnectionView } from "./connection-interface";
import type { ConnectionConfig } from "./types";
import { startScenarioAgent } from "../../scripts/fixture-scenario-agent.mjs";

// WF-66: which tenant reaches an agent whose Agent Card interfaces declare one.
let agent: Awaited<ReturnType<typeof startScenarioAgent>>;
beforeAll(async () => { agent = await startScenarioAgent({ behaviors: { tenants: ["acme"] } }); });
afterAll(async () => { await agent.close(); });

const connection = (): ConnectionConfig => ({ cardUrl: agent.cardUrl, auth: { type: "none" }, headers: {} });
const sentTenants = async (method: string) => (await agent.state()).log.filter((entry: { method: string }) => entry.method === method)
  .map((entry: { params: { tenant?: string } }) => entry.params.tenant);

it("WF-66 fills the tenant from the selected interface when Taskbay sends an empty tenant", async () => {
  const sent = await executeOperation({ connection: connection(), action: "send", params: { text: "hello", tenant: "" } });
  const task = sent.result as { id: string };
  expect(await sentTenants("SendMessage")).toEqual(["acme"]);
  await executeOperation({ connection: connection(), action: "getTask", params: { taskId: task.id, tenant: "" } });
  expect(await sentTenants("GetTask")).toEqual(["acme"]);
});

it("refuses an explicit tenant that has no compatible interface", async () => {
  await expect(executeOperation({ connection: connection(), action: "listTasks", params: { tenant: "other" } })).rejects.toThrow("No advertised interface matches");
  expect(await sentTenants("ListTasks")).toEqual([]);
});

// An agent whose card lists several tenants. The chosen tenant is resolved before sending and stored, so it goes out explicitly.
describe("WF-66 multi-tenant agent", () => {
  let multi: Awaited<ReturnType<typeof startScenarioAgent>>;
  beforeAll(async () => { multi = await startScenarioAgent({ behaviors: { tenants: ["acme", "beta"], tenantPaths: true } }); });
  afterAll(async () => { await multi.close(); });
  const config = (): ConnectionConfig => ({ cardUrl: multi.cardUrl, auth: { type: "none" }, headers: {} });
  const sent = async (method: string) => (await multi.state()).log.filter((entry: { method: string }) => entry.method === method)
    .map((entry: { params: { tenant?: string } }) => entry.params.tenant);

  it("lists both tenants and defaults to the interface the client would use", async () => {
    const discovery = await discoverAgent(config());
    const view = buildConnectionView(discovery.normalizedCard.supportedInterfaces, config(), { advertised: [], negotiated: [], required: [], unsupportedRequired: [] });
    expect(view.tenants).toEqual(["acme", "beta"]);
    expect(view.tenant).toBe("beta");
    expect(view.pinned).toBe(false);
  });

  it("sends the chosen tenant for a new conversation and keeps it for the follow-up", async () => {
    const first = await executeOperation({ connection: config(), action: "send", params: { text: "hello", tenant: "beta" } });
    const task = first.result as { id: string };
    await executeOperation({ connection: config(), action: "send", params: { text: "more", taskId: task.id, tenant: "beta" } });
    expect(await sent("SendMessage")).toEqual(["beta", "beta"]);
    await executeOperation({ connection: config(), action: "send", params: { text: "again", tenant: "acme" } });
    expect(await sent("SendMessage")).toEqual(["beta", "beta", "acme"]);
  });

  it("routes reads, streaming, cancellation and push configurations to the tenant's own URL", async () => {
    const started = await executeOperation({ connection: config(), action: "send", params: { text: "route checks", tenant: "acme" } });
    const taskId = (started.result as { id: string }).id;
    expect(started.tenant).toBe("acme");
    await executeOperation({ connection: config(), action: "getTask", params: { taskId, tenant: "acme" } });
    await executeOperation({ connection: config(), action: "listTasks", params: { tenant: "acme" } });
    await executeOperation({ connection: config(), action: "createPushConfig", params: { tenant: "acme", taskId, configId: "p", url: "https://callback.test/p" } });
    await executeOperation({ connection: config(), action: "listPushConfigs", params: { tenant: "acme", taskId } });
    await executeOperation({ connection: config(), action: "deletePushConfig", params: { tenant: "acme", taskId, configId: "p" } });
    const controller = new AbortController();
    const stream = await streamOperation({ connection: config(), action: "getTask", params: { tenant: "acme", taskId }, signal: controller.signal });
    const first = await stream.events.next();
    expect(first.done).toBe(false);
    controller.abort();
    await stream.events.return();
    await executeOperation({ connection: config(), action: "cancelTask", params: { taskId, tenant: "acme" } });
    const requests = (await multi.state()).log.filter((entry: { params: { tenant?: string } }) => entry.params.tenant === "acme");
    expect(requests.every((entry: { path: string }) => entry.path === "/acme/a2a")).toBe(true);
    expect(requests.some((entry: { method: string }) => entry.method === "SubscribeToTask")).toBe(true);
    await expect(executeOperation({ connection: { ...config(), interfaceUrl: multi.origin + "/beta/a2a" }, action: "send", params: { tenant: "acme", text: "wrong pin" } }))
      .rejects.toThrow("No advertised interface matches");
  });
});
