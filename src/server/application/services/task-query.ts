import type { DurableTaskView } from "../../../shared/task-types";
import type { AgentRepository, TaskListQuery, TaskRepository } from "../ports/persistence";
import type { TaskRecord } from "../../domain/persistence-model";
import type { TaskOrigin } from "../../domain/discovery-mode";
import { encodeTaskCursor } from "../../domain/task-cursor";
import { object } from "./task-projection";
import { readSteering, type SteeringSources } from "./steering";
import { terminalTask } from "../ports/reconciliation";
import type { TaskLinkRepository } from "../ports/task-links";

export class TaskQueryService {
  /** `names` resolves people for display (who tracked a task); without it that field is left out. */
  constructor(private readonly tasks: TaskRepository, private readonly agents: AgentRepository, private readonly names?: (userIds: string[]) => Promise<Record<string, string>>,
    /** Where the steering outcome of messages sent to a working task is read from; without it `detail` leaves `steering` out. */
    private readonly steering?: SteeringSources, private readonly links?: TaskLinkRepository, private readonly canOperate?: (task: TaskRecord) => boolean) {}

  async contentPage(organizationId: string, limit = 100, after?: string) {
    const rows = await this.tasks.listContentPage(organizationId, limit + 1, after);
    const tasks: DurableTaskView[] = [];
    for (const row of rows.slice(0, limit)) tasks.push(await this.view(organizationId, row));
    return { tasks, next: rows.length > limit ? tasks.at(-1)!.localId : null };
  }

  /** The newest tasks, positional form for callers that need only the rows. See `listPage` for filters and cursors. */
  async list(organizationId: string, limit = 50, offset = 0, filter = "all", restriction?: { include?: string[]; exclude?: string[] }, origin?: TaskOrigin) {
    return (await this.listPage(organizationId, { limit, offset, filter, restriction, origin })).tasks;
  }

  /** One page of summaries plus `next`, a cursor for the following page (null on the last page). */
  async listPage(organizationId: string, query: TaskListQuery) {
    const limit = query.limit;
    const fetched = await this.tasks.listByOrganization(organizationId, { ...query, limit: limit + 1 });
    const rows = fetched.slice(0, limit);
    const last = rows.at(-1);
    const next = fetched.length > limit && last ? encodeTaskCursor({ updatedAt: last.updatedAt, id: last.id }) : null;
    const agents = new Map((await this.agents.listByOrganization(organizationId)).map((agent) => [agent.id, agent]));
    const tasks = rows.map((task) => ({
      localId: task.id, taskId: task.remoteTaskId!, tenant: task.tenant,
      agentId: task.agentId, agentName: agents.get(task.agentId)?.displayName ?? "Agent",
      state: task.state, kind: "task" as const, title: task.title ?? undefined,
      contextId: task.remoteContextId ?? undefined, origin: task.origin ?? "created",
      createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
      messages: [], artifacts: [], referenceLinks: {},
    }));
    return { tasks, next };
  }

  async detail(organizationId: string, localId: string): Promise<DurableTaskView | undefined> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(localId)) return undefined;
    const task = await this.tasks.findById(organizationId, localId);
    if (!task) return undefined;
    const view = await this.view(organizationId, task);
    view.canOperate = this.canOperate?.(task) ?? false;
    view.cancelable = task.kind === "task" && !task.terminalAt && !terminalTask(task.state);
    if (task.origin === "discovered") {
      const people = task.trackedByUserId && this.names ? await this.names([task.trackedByUserId]) : {};
      view.trackedBy = task.trackedByUserId && people[task.trackedByUserId] ? { userId: task.trackedByUserId, name: people[task.trackedByUserId] } : null;
    }
    if (task.remoteContextId) {
      // Same visibility rules as the list: the repository applies the caller's access filter.
      const siblings = await this.tasks.listByOrganization(organizationId, {
        limit: 20, contextId: task.remoteContextId, agentId: task.agentId, tenant: task.tenant, restriction: { exclude: [task.id] },
      });
      view.contextSiblings = siblings.map((sibling) => ({ localId: sibling.id, taskId: sibling.remoteTaskId ?? sibling.id, state: sibling.state, title: sibling.title ?? undefined, updatedAt: sibling.updatedAt.toISOString() }));
    } else view.contextSiblings = [];
    if (this.steering) view.steering = await readSteering(task, this.steering);
    if (this.links) view.related = await this.links.findRelated(organizationId, task.id);
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
