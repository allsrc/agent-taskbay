import { executeOperation } from "../../../lib/gateway";
import type { A2AReconciliationGateway } from "../../application/ports/reconciliation";
import { ListTasksUnsupported } from "../../application/ports/reconciliation";
import type { AgentRecord, JsonValue, SyncCursorRecord, TaskRecord } from "../../domain/persistence-model";

export class SdkReconciliationGateway implements A2AReconciliationGateway {
  private connection(agent: AgentRecord) { return { cardUrl: agent.cardUrl, auth: { type: "none" as const }, headers: {} }; }
  async get(agent: AgentRecord, task: TaskRecord, signal: AbortSignal): Promise<JsonValue> {
    const response = await executeOperation({ connection: this.connection(agent), signal, action: "getTask",
      params: { taskId: task.remoteTaskId, tenant: task.tenant } });
    return { task: response.result as JsonValue };
  }
  async list(agent: AgentRecord, cursor: SyncCursorRecord, signal: AbortSignal) {
    try {
      const response = await executeOperation({ connection: this.connection(agent), signal, action: "listTasks",
        params: { tenant: cursor.tenant, pageToken: cursor.pageToken, pageSize: 100, includeArtifacts: true } });
      const result = response.result as { tasks?: JsonValue[]; nextPageToken?: string };
      if (!Array.isArray(result.tasks) || typeof result.nextPageToken !== "string") throw new Error("Invalid task list.");
      return { tasks: result.tasks.map((task) => ({ task })), nextPageToken: result.nextPageToken };
    } catch (error) {
      if (error instanceof Error && (["MethodNotFoundError", "UnsupportedOperationError", "JsonRpcUnsupportedOperationError"].includes(error.name) || (error as Error & { envelopeCode?: number }).envelopeCode === -32601)) throw new ListTasksUnsupported();
      throw error;
    }
  }
}
