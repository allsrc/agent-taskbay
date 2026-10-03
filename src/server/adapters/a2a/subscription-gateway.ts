import { serializeStreamEvent, streamOperation } from "../../../lib/gateway";
import type { A2ASubscriptionGateway } from "../../application/ports/subscriptions";
import { SubscriptionUnsupported } from "../../application/ports/subscriptions";
import type { AgentRecord, JsonValue, TaskRecord } from "../../domain/persistence-model";

export class SdkSubscriptionGateway implements A2ASubscriptionGateway {
  async subscribe(agent: AgentRecord, task: TaskRecord, signal: AbortSignal) {
    try {
      const session = await streamOperation({ connection: { cardUrl: agent.cardUrl, auth: { type: "none" }, headers: {} },
        action: "getTask", params: { taskId: task.remoteTaskId, tenant: task.tenant }, signal });
      return {
        metadata: { protocolVersion: session.client.protocolVersion, transport: session.client.transport.protocolName,
          negotiatedExtensions: session.negotiatedExtensions },
        events: (async function* () { for await (const event of session.events) yield serializeStreamEvent(event) as JsonValue; })(),
      };
    } catch (error) {
      if (error instanceof Error && error.message === "STREAMING_UNSUPPORTED") throw new SubscriptionUnsupported();
      throw error;
    }
  }
}
