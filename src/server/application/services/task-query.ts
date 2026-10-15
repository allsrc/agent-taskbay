import type { DurableTaskView } from "../../../shared/task-types";
import type { AgentRepository, TaskRepository } from "../ports/persistence";
import type { TaskRecord } from "../../domain/persistence-model";
import type { TaskOrigin } from "../../domain/discovery-mode";
import { object } from "./task-projection";

export class TaskQueryService {
  /** `names` resolves people for display (who tracked a task); without it that field is left out. */
  constructor(private readonly tasks: TaskRepository, private readonly agents: AgentRepository, private readonly names?: (userIds: string[]) => Promise<Record<string, string>>) {}

  async contentPage(organizationId: string, limit = 100, after?: string) {
    const rows = await this.tasks.listContentPage(organizationId, limit + 1, after);
    const tasks: DurableTaskView[] = [];
    for (const row of rows.slice(0, limit)) tasks.push(await this.view(organizationId, row));
    return { tasks, next: rows.length > limit ? tasks.at(-1)!.localId : null };
  }

  async list(organizationId: string, limit = 50, offset = 0, filter = "all", restriction?: { include?: string[]; exclude?: string[] }, origin?: TaskOrigin) {
    const rows = await this.tasks.listByOrganization(organizationId, limit, offset, filter, restriction, origin);
    const agents = new Map((await this.agents.listByOrganization(organizationId)).map((agent) => [agent.id, agent]));
    return rows.map((task) => ({
      localId: task.id, taskId: task.remoteTaskId!, tenant: task.tenant,
      agentId: task.agentId, agentName: agents.get(task.agentId)?.displayName ?? "Agent",
      state: task.state, kind: "task" as const, title: task.title ?? undefined,
      contextId: task.remoteContextId ?? undefined, origin: task.origin ?? "created",
      createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
      messages: [], artifacts: [], referenceLinks: {},
    }));
  }

  async detail(organizationId: string, localId: string): Promise<DurableTaskView | undefined> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(localId)) return undefined;
    const task = await this.tasks.findById(organizationId, localId);
    if (!task) return undefined;
    const view = await this.view(organizationId, task);
    if (task.origin === "discovered") {
      const people = task.trackedByUserId && this.names ? await this.names([task.trackedByUserId]) : {};
      view.trackedBy = task.trackedByUserId && people[task.trackedByUserId] ? { userId: task.trackedByUserId, name: people[task.trackedByUserId] } : null;
    }
    return view;
  }

  private async view(organizationId: string, task: TaskRecord): Promise<DurableTaskView> {
    const agent = await this.agents.findById(organizationId, task.agentId);
    const view = {
      taskId: task.remoteTaskId ?? task.id, agentId: task.agentId, agentName: agent?.displayName ?? "Agent",
      kind: task.kind === "message" ? "message" : "task", state: task.state,
      createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(), messages: [], artifacts: [],
      ...object(task.contentJson), localId: task.id, tenant: task.tenant, skillId: task.skillId ?? undefined, version: task.version, referenceLinks: {},
      ...(task.origin === "discovered" ? { origin: "discovered" as const, discoveredAt: task.discoveredAt?.toISOString() } : {}),
    } as DurableTaskView;
    for (const remoteId of new Set(view.messages.flatMap((message) => message.referenceTaskIds ?? []))) {
      const reference = await this.tasks.findByRemoteIdentity({ organizationId, agentId: task.agentId, tenant: task.tenant, remoteTaskId: remoteId });
      if (reference) view.referenceLinks[remoteId] = reference.id;
    }
    return view;
  }
}
