import { redactSecrets } from "../../../lib/safe-fetch";
import { agentConnection } from "./agent-connection";
import { serializeStreamEvent, streamOperation } from "../../../lib/gateway";
import type { A2ASubscriptionGateway } from "../../application/ports/subscriptions";
import { SubscriptionUnsupported } from "../../application/ports/subscriptions";
import type { AgentRecord, JsonValue, TaskRecord } from "../../domain/persistence-model";

export class SdkSubscriptionGateway implements A2ASubscriptionGateway {
  async subscribe(agent: AgentRecord, task: TaskRecord, signal: AbortSignal) {
    let protectedConnection = false;
    try {
      const connection = await agentConnection(agent);
      protectedConnection = Boolean(connection.secretValues?.length);
      const session = await streamOperation({ connection,
        action: "getTask", params: { taskId: task.remoteTaskId, tenant: task.tenant }, signal });
      return {
        metadata: { protocolVersion: session.client.protocolVersion, transport: session.client.transport.protocolName,
          negotiatedExtensions: session.negotiatedExtensions },
        events: (async function* () {
          try {for await (const event of session.events) yield redactSecrets(serializeStreamEvent(event), connection.secretValues) as JsonValue;}
          catch (error) {if (protectedConnection) throw new Error("Protected agent stream failed.");throw error;}
        })(),
      };
    } catch (error) {
      if (error instanceof Error && error.message === "STREAMING_UNSUPPORTED") throw new SubscriptionUnsupported();
      if (protectedConnection) throw new Error("Protected agent subscription failed.");
      throw error;
    }
  }
}
