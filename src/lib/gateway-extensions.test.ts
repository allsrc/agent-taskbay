import { describe, expect, it } from "vitest";
import { discoverAgent, executeOperation, streamOperation } from "./gateway";
import { understoodExtensionUris } from "../server/sideband/extension";
import { extractSidebandEvents } from "../server/sideband/decoder";
import { STRUCTURED_FORM_EXTENSION_URI } from "./structured-form";
import { startScenarioAgent } from "../../scripts/fixture-scenario-agent.mjs";

describe("required extensions on the wire", () => {
  it.each(understoodExtensionUris())("declares %s on sends, reads and subscriptions", async (uri) => {
    const agent = await startScenarioAgent({ behaviors: { requireExtension: uri, enforceExtensions: true } });
    const connection = { cardUrl: agent.cardUrl, auth: { type: "none" as const }, headers: {} };
    try {
      const discovery = await discoverAgent(connection);
      expect(discovery.sideband?.unsupportedRequiredUris).toEqual([]);
      expect(discovery.sideband?.negotiatedUris).toContain(uri);
      const sent = await executeOperation({ connection, action: "send", params: { text: "hello" } });
      const taskId = (sent.result as { id: string }).id;
      await executeOperation({ connection, action: "getTask", params: { taskId } });
      const controller = new AbortController();
      const stream = await streamOperation({ connection, action: "getTask", params: { taskId }, signal: controller.signal });
      expect((await stream.events.next()).done).toBe(false);
      controller.abort();
      await stream.events.return();
      expect((await agent.state()).log.every((entry: { extensions: string }) => entry.extensions.split(",").map((value) => value.trim()).includes(uri))).toBe(true);
    } finally { await agent.close(); }
  });

  it("does not decode a negotiated form extension as sideband events", () => {
    expect(extractSidebandEvents({ message: { metadata: { [STRUCTURED_FORM_EXTENSION_URI]: { fields: [] } } } },
      { sessionId: "s", requestId: "r", negotiatedExtensions: [STRUCTURED_FORM_EXTENSION_URI] })).toEqual([]);
  });
});
