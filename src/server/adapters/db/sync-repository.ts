import { LockMode, type EntityManager } from "@mikro-orm/core";
import { randomUUID } from "node:crypto";
import type { SyncCursorRepository } from "../../application/ports/reconciliation";
import { terminalTask } from "../../application/ports/reconciliation";
import type { SyncCursorRecord, TaskRecord } from "../../domain/persistence-model";
import { AgentEntity, SyncCursorEntity, TaskEntity } from "./entities";

export class MikroOrmSyncCursorRepository implements SyncCursorRepository {
  constructor(private readonly em: EntityManager) {}
  async sync(task: TaskRecord, now: Date) {
    if (task.kind !== "task" || !task.remoteTaskId) return;
    const stopped = terminalTask(task.state);
    for (const resourceKey of ["", task.id]) {
      await this.em.upsert(SyncCursorEntity, {
        id: randomUUID(), organizationId: task.organizationId, agentId: task.agentId, tenant: task.tenant,
        resourceKey, taskId: resourceKey ? task.id : null, status: resourceKey && stopped ? "stopped" : "pending",
        pageToken: "", availableAt: now, attempts: 0, leaseOwner: null, leaseUntil: null, lastError: null,
        lastSyncedAt: null, createdAt: now, updatedAt: now,
      }, { onConflictFields: ["organizationId", "agentId", "tenant", "resourceKey"], onConflictAction: "ignore", disableIdentityMap: true });
    }
    if (stopped) await this.em.nativeUpdate(SyncCursorEntity, { organizationId: task.organizationId, taskId: task.id },
      { status: "stopped", leaseOwner: null, leaseUntil: null, lastError: null, updatedAt: now });
  }
  async find(organizationId: string, agentId: string, tenant: string, resourceKey: string) {
    const row = await this.em.findOne(SyncCursorEntity, { organizationId, agentId, tenant, resourceKey }, { refresh: true });
    return row ? this.record(row) : undefined;
  }
  async claim(owner: string, now: Date, until: Date) {
    const row = await this.em.findOne(SyncCursorEntity, {
      $or: [{ status: "pending", availableAt: { $lte: now } }, { status: "syncing", leaseUntil: { $lte: now } }],
    }, { orderBy: { availableAt: "asc", id: "asc" }, lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE, refresh: true });
    if (!row) return undefined;
    this.em.assign(row, { status: "syncing", leaseOwner: owner, leaseUntil: until, attempts: row.attempts + 1, updatedAt: now });
    await this.em.flush();
    return this.record(row);
  }
  private fence(cursor: SyncCursorRecord, now: Date) {
    return { id: cursor.id, organizationId: cursor.organizationId, status: "syncing" as const, leaseOwner: cursor.leaseOwner, leaseUntil: { $gt: now } };
  }
  async renew(cursor: SyncCursorRecord, now: Date, until: Date) {
    return (await this.em.nativeUpdate(SyncCursorEntity, this.fence(cursor, now), { leaseUntil: until, updatedAt: now })) === 1;
  }
  async finish(cursor: SyncCursorRecord, now: Date, changes: Pick<SyncCursorRecord, "status" | "availableAt" | "lastError" | "pageToken" | "lastSyncedAt">) {
    return (await this.em.nativeUpdate(SyncCursorEntity, this.fence(cursor, now),
      { ...changes, leaseOwner: null, leaseUntil: null, updatedAt: now })) === 1;
  }
  async knownTasks(cursor: SyncCursorRecord): Promise<TaskRecord[]> {
    // A disabled/foreign agent must not make a late read authoritative.
    if (!await this.em.findOne(AgentEntity, { id: cursor.agentId, organizationId: cursor.organizationId, enabled: true }, { refresh: true })) return [];
    const rows = await this.em.find(TaskEntity, { organizationId: cursor.organizationId, agentId: cursor.agentId,
      tenant: cursor.tenant, kind: "task", ...(cursor.taskId ? { id: cursor.taskId } : {}) }, { refresh: true });
    return rows.filter((row) => !terminalTask(row.state)).map((row) => ({ ...row,
      remoteTaskId: row.remoteTaskId ?? null, remoteContextId: row.remoteContextId ?? null,
      title: row.title ?? null, ownerUserId: row.ownerUserId ?? null, ownerTeamId: row.ownerTeamId ?? null,
      remoteCreatedAt: row.remoteCreatedAt ?? null, remoteUpdatedAt: row.remoteUpdatedAt ?? null, terminalAt: row.terminalAt ?? null,
    }));
  }
  private record(row: SyncCursorEntity): SyncCursorRecord {
    return { ...row, taskId: row.taskId ?? null, leaseOwner: row.leaseOwner ?? null,
      leaseUntil: row.leaseUntil ?? null, lastError: row.lastError ?? null, lastSyncedAt: row.lastSyncedAt ?? null };
  }
}
