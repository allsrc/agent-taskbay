import type { DurableTaskView } from "../../../shared/task-types";
import type { AgentRepository, TaskRepository } from "../ports/persistence";
import { object } from "./task-projection";

export class TaskQueryService {
  constructor(private readonly tasks: TaskRepository, private readonly agents: AgentRepository) {}

  async list(organizationId: string, limit = 50, offset = 0, filter = "all") {
    const rows = await this.tasks.listByOrganization(organizationId, limit, offset, filter);
    const agents = new Map((await this.agents.listByOrganization(organizationId)).map((agent) => [agent.id, agent]));
    return rows.map((task) => ({
      localId: task.id, taskId: task.remoteTaskId!, tenant: task.tenant,
      agentId: task.agentId, agentName: agents.get(task.agentId)?.displayName ?? "Agent",
      state: task.state, kind: "task" as const, title: task.title ?? undefined,
      contextId: task.remoteContextId ?? undefined,
      createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
      messages: [], artifacts: [], referenceLinks: {},
    }));
  }

  async detail(organizationId: string, localId: string): Promise<DurableTaskView | undefined> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(localId)) return undefined;
    const task = await this.tasks.findById(organizationId, localId);
    if (!task) return undefined;
    const agent = await this.agents.findById(organizationId, task.agentId);
    const view = {
      taskId: task.remoteTaskId ?? task.id, agentId: task.agentId, agentName: agent?.displayName ?? "Agent",
      kind: task.kind === "message" ? "message" : "task", state: task.state,
      createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(), messages: [], artifacts: [],
      ...object(task.contentJson), localId: task.id, tenant: task.tenant, referenceLinks: {},
    } as DurableTaskView;
    for (const remoteId of new Set(view.messages.flatMap((message) => message.referenceTaskIds ?? []))) {
      const reference = await this.tasks.findByRemoteIdentity({ organizationId, agentId: task.agentId, tenant: task.tenant, remoteTaskId: remoteId });
      if (reference) view.referenceLinks[remoteId] = reference.id;
    }
    return view;
  }
}
