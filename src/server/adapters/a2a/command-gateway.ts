import { agentConnection } from "./agent-connection";
import { executeOperation } from "../../../lib/gateway";
import type { A2ACommandGateway } from "../../application/ports/command-dispatch";
import { SafeDispatchRetry } from "../../application/ports/command-dispatch";
import { classifyRemoteError } from "./remote-error-map";
import { RemoteRejection } from "../../application/ports/remote-errors";
import type { AgentRecord, TaskCommandRecord, JsonValue } from "../../domain/persistence-model";

export class SdkCommandGateway implements A2ACommandGateway {
  async dispatch(agent: AgentRecord, command: TaskCommandRecord, params: Record<string, JsonValue>): Promise<JsonValue> {
    let dispatched = false;
    try {
      const response = await executeOperation({ connection: await agentConnection(agent),
        action: command.action, params, sessionId: command.id, requestId: command.id,
        onDispatch: () => { dispatched = true; } });
      const raw = response.result as Record<string, unknown>;
      return { [raw.status ? "task" : "message"]: raw,
        ...(command.action === "send" && !params.taskId && response.tenant ? { tenant: response.tenant } : {}) } as JsonValue;
    } catch (error) {
      if (!dispatched) throw new SafeDispatchRetry("Discovery failed before remote dispatch.");
      // A definite A2A refusal means the agent did not act; anything else after dispatch stays uncertain.
      const refusal = classifyRemoteError(error);
      if (refusal) throw new RemoteRejection(refusal.kind, refusal.code);
      throw error;
    }
  }
}
