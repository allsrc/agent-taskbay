import { afterAll, beforeAll, expect, it } from "vitest";
import { executeOperation } from "./gateway";
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
