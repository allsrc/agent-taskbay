import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverAgent, executeOperation } from "./gateway";
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

it("WF-66 keeps an explicit tenant instead of the interface default", async () => {
  await executeOperation({ connection: connection(), action: "listTasks", params: { tenant: "other" } });
  expect(await sentTenants("ListTasks")).toEqual(["other"]);
});

// An agent whose card lists several tenants. The chosen tenant is resolved before sending and stored, so it goes out explicitly.
describe("WF-66 multi-tenant agent", () => {
  let multi: Awaited<ReturnType<typeof startScenarioAgent>>;
  beforeAll(async () => { multi = await startScenarioAgent({ behaviors: { tenants: ["acme", "beta"] } }); });
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
});
