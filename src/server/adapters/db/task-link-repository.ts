import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { RelatedTask, RelatedTasks } from "../../../shared/task-types";
import type { TaskLinkRepository } from "../../application/ports/task-links";
import type { TaskRecord } from "../../domain/persistence-model";
import { AgentEntity, TaskEntity, TaskLinkEntity } from "./entities";
import { terminalTask } from "../../application/ports/reconciliation";
import { requestAccessPolicy, taskAccessFilter } from "./security-repository";

export class MikroOrmTaskLinkRepository implements TaskLinkRepository {
  constructor(private readonly em: EntityManager) {}

  async recordReferences(task: TaskRecord, remoteTaskIds: string[], now: Date) {
    if (!remoteTaskIds.length) return;
    // Ingestion resolves identities independently of the human who happened to trigger it.
    // Grants affect reads, not the durable relationship reported by an agent.
    const source = await this.em.findOne(TaskEntity, { id: task.id, organizationId: task.organizationId, agentId: task.agentId, tenant: task.tenant }, { fields: ["id"] });
    if (!source) return;
    const ids = [...new Set(remoteTaskIds)];
    for (let offset = 0; offset < ids.length; offset += 500) {
      const targets = await this.em.find(TaskEntity, { organizationId: task.organizationId, agentId: task.agentId, tenant: task.tenant,
        remoteTaskId: { $in: ids.slice(offset, offset + 500) } }, { fields: ["id"] });
      for (const target of targets) await this.em.upsert(TaskLinkEntity, {
        id: randomUUID(), organizationId: task.organizationId, fromTaskId: task.id, toTaskId: target.id, kind: "references", createdAt: now,
      }, { onConflictFields: ["fromTaskId", "toTaskId", "kind"], onConflictAction: "ignore" });
    }
  }

  async findRelated(organizationId: string, taskId: string): Promise<RelatedTasks> {
    const empty = { references: [], referencedBy: [] };
    const access = await taskAccessFilter(this.em);
    const policy = await requestAccessPolicy(this.em);
    if (!await this.em.findOne(TaskEntity, { organizationId, id: taskId, $and: [access] }, { fields: ["id"] })) return empty;
    const links = await this.em.find(TaskLinkEntity, { organizationId, kind: "references", $or: [{ fromTaskId: taskId }, { toTaskId: taskId }] });
    const ids = [...new Set(links.map((link) => link.fromTaskId === taskId ? link.toTaskId : link.fromTaskId))];
    if (!ids.length) return empty;
    const tasks = await this.em.find(TaskEntity, { organizationId, id: { $in: ids }, $and: [access] },
      { fields: ["id", "remoteTaskId", "agentId", "state", "title", "skillId", "tenant", "kind", "terminalAt"], orderBy: { createdAt: "asc", id: "asc" }, refresh: true });
    if (!tasks.length) return empty;
    const agents = await this.em.find(AgentEntity, { organizationId, id: { $in: [...new Set(tasks.map((task) => task.agentId))] } });
    const names = new Map(agents.map((agent) => [agent.id, agent.nickname || agent.displayName || "Agent"]));
    const summary = (task: typeof tasks[number]): RelatedTask => ({ localId: task.id, taskId: task.remoteTaskId ?? task.id,
      agentId: task.agentId, tenant: task.tenant, canOperate: policy?.allows(task.agentId, "operate", task.skillId) ?? false,
      cancelable: task.kind === "task" && !task.terminalAt && !terminalTask(task.state),
      agentName: names.get(task.agentId) ?? "Agent", state: task.state, title: task.title ?? undefined });
    const outgoing = new Set(links.filter((link) => link.fromTaskId === taskId).map((link) => link.toTaskId));
    const incoming = new Set(links.filter((link) => link.toTaskId === taskId).map((link) => link.fromTaskId));
    return { references: tasks.filter((task) => outgoing.has(task.id)).map(summary), referencedBy: tasks.filter((task) => incoming.has(task.id)).map(summary) };
  }
}
