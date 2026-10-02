import { executeOperation } from "../../../lib/gateway";
import type { A2ACommandGateway } from "../../application/ports/command-dispatch";
import { SafeDispatchRetry } from "../../application/ports/command-dispatch";
import type { AgentRecord, TaskCommandRecord, JsonValue } from "../../domain/persistence-model";

export class SdkCommandGateway implements A2ACommandGateway {
  async dispatch(agent: AgentRecord, command: TaskCommandRecord, params: Record<string, JsonValue>): Promise<JsonValue> {
    let dispatched = false;
    try {
      const response = await executeOperation({ connection: { cardUrl: agent.cardUrl, auth: { type: "none" }, headers: {} },
        action: command.action, params, sessionId: command.id, requestId: command.id,
        onDispatch: () => { dispatched = true; } });
      const raw = response.result as Record<string, unknown>;
      return { [raw.status ? "task" : "message"]: raw } as JsonValue;
    } catch (error) {
      if (!dispatched) throw new SafeDispatchRetry("Discovery failed before remote dispatch.");
      throw error;
    }
  }
}
