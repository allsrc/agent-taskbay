import { agentConnection } from "./agent-connection";
import { executeOperation, discoverAgent } from "../../../lib/gateway";
import type { A2APushGateway } from "../../application/ports/push";
import { PushUnsupported } from "../../application/ports/push";
import type { AgentRecord, TaskRecord } from "../../domain/persistence-model";

export class SdkPushGateway implements A2APushGateway {
  private connection(agent: AgentRecord) { return agentConnection(agent); }
  async register(agent: AgentRecord, task: TaskRecord, id: string, url: string, credential: string, signal: AbortSignal) {
    const connection = await this.connection(agent);
    if (!(await discoverAgent(connection)).normalizedCard.capabilities?.pushNotifications) throw new PushUnsupported();
    // Do not expose or persist config responses, including echoed credentials/telemetry.
    try {
      const existing = await executeOperation({ connection, signal, action: "getPushConfig",
        params: { taskId: task.remoteTaskId, tenant: task.tenant, configId: id } });
      const config = existing.result as { id?: string; taskId?: string; tenant?: string; url?: string };
      if (config.id === id && config.taskId === task.remoteTaskId && (config.tenant ?? "") === task.tenant && config.url === url) return;
      throw new Error("Unexpected push configuration identity.");
    } catch (error) {
      if (!(error instanceof Error && error.name === "TaskNotFoundError")) throw error;
    }
    const created = await executeOperation({ connection, signal, action: "createPushConfig", params: {
      taskId: task.remoteTaskId, tenant: task.tenant, configId: id, url,
      authentication: { scheme: "Bearer", credentials: credential },
    } });
    const config = created.result as { id?: string; taskId?: string; tenant?: string; url?: string };
    if (config.id !== id || config.taskId !== task.remoteTaskId || (config.tenant ?? "") !== task.tenant || config.url !== url)
      throw new Error("Unexpected push configuration identity.");
  }
  async remove(agent: AgentRecord, task: TaskRecord, id: string, signal: AbortSignal) {
    try {
      await executeOperation({ connection: await this.connection(agent), signal, action: "deletePushConfig",
        params: { taskId: task.remoteTaskId, tenant: task.tenant, configId: id } });
    } catch (error) {
      // A2A has no separate config-not-found type; peers use TaskNotFoundError.
      if (error instanceof Error && error.name === "TaskNotFoundError") return;
      throw error;
    }
  }
}
