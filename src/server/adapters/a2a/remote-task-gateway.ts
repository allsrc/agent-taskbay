import { agentConnection } from "./agent-connection";
import { classifyRemoteError } from "./remote-error-map";
import { executeOperation } from "../../../lib/gateway";
import type { RemoteTaskGateway, RemoteTaskQuery } from "../../application/ports/remote-tasks";
import { RemoteRejection } from "../../application/ports/remote-errors";
import { ListTasksUnsupported } from "../../application/ports/reconciliation";
import type { AgentRecord, JsonValue } from "../../domain/persistence-model";

export class SdkRemoteTaskGateway implements RemoteTaskGateway {
  async list(agent: AgentRecord, query: RemoteTaskQuery) {
    try {
      const response = await executeOperation({ connection: await agentConnection(agent), action: "listTasks",
        params: { tenant: query.tenant, contextId: query.contextId, status: query.status, pageToken: query.pageToken ?? "", pageSize: query.pageSize,
          historyLength: 1, includeArtifacts: false } });
      const result = response.result as { tasks?: JsonValue[]; nextPageToken?: string };
      if (result.tasks !== undefined && !Array.isArray(result.tasks)) throw new Error("Invalid task list.");
      return { tasks: result.tasks ?? [], nextPageToken: typeof result.nextPageToken === "string" ? result.nextPageToken : "", tenant: response.tenant ?? query.tenant };
    } catch (error) {
      // An agent that cannot list tasks answers "unsupported"; any other refusal is reported as it is.
      const refusal = classifyRemoteError(error);
      if (refusal?.kind === "unsupported_operation") throw new ListTasksUnsupported();
      if (refusal) throw new RemoteRejection(refusal.kind, refusal.code);
      throw error;
    }
  }

  async get(agent: AgentRecord, tenant: string, taskId: string) {
    try {
      const response = await executeOperation({ connection: await agentConnection(agent), action: "getTask", params: { taskId, tenant } });
      return { task: response.result as JsonValue, tenant: response.tenant ?? tenant };
    } catch (error) {
      const refusal = classifyRemoteError(error);
      if (refusal) throw new RemoteRejection(refusal.kind, refusal.code);
      throw error;
    }
  }
}
