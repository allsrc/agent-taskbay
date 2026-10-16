import { agentConnection } from "./agent-connection";
import { executeOperation } from "../../../lib/gateway";
import type { A2AReconciliationGateway } from "../../application/ports/reconciliation";
import { ListTasksUnsupported, type ListOptions } from "../../application/ports/reconciliation";
import type { AgentRecord, JsonValue, SyncCursorRecord, TaskRecord } from "../../domain/persistence-model";

export class SdkReconciliationGateway implements A2AReconciliationGateway {
  private connection(agent: AgentRecord) { return agentConnection(agent); }
  async get(agent: AgentRecord, task: TaskRecord, signal: AbortSignal, historyLength?: number): Promise<JsonValue> {
    const response = await executeOperation({ connection: await this.connection(agent), signal, action: "getTask",
      params: { taskId: task.remoteTaskId, tenant: task.tenant, ...(historyLength !== undefined ? { historyLength } : {}) } });
    return { task: response.result as JsonValue };
  }
  async list(agent: AgentRecord, cursor: SyncCursorRecord, signal: AbortSignal, options?: ListOptions) {
    try {
      const response = await executeOperation({ connection: await this.connection(agent), signal, action: "listTasks",
        params: { tenant: cursor.tenant, pageToken: cursor.pageToken, pageSize: 100, includeArtifacts: true,
          ...(options?.statusTimestampAfter ? { statusTimestampAfter: options.statusTimestampAfter.toISOString() } : {}),
          ...(options?.historyLength !== undefined ? { historyLength: options.historyLength } : {}) } });
      const result = response.result as { tasks?: JsonValue[]; nextPageToken?: string };
      // The SDK leaves empty fields out of a serialized response, so the last page has no token and an empty list has no `tasks`.
      if (result.tasks !== undefined && !Array.isArray(result.tasks) || result.nextPageToken !== undefined && typeof result.nextPageToken !== "string") throw new Error("Invalid task list.");
      return { tasks: (result.tasks ?? []).map((task) => ({ task })), nextPageToken: result.nextPageToken ?? "", tenant: response.tenant ?? cursor.tenant };
    } catch (error) {
      if (error instanceof Error && (["MethodNotFoundError", "UnsupportedOperationError", "JsonRpcUnsupportedOperationError"].includes(error.name) || (error as Error & { envelopeCode?: number }).envelopeCode === -32601)) throw new ListTasksUnsupported();
      throw error;
    }
  }
}
