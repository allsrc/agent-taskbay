import { LockMode, type EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/sql";
import { randomUUID } from "node:crypto";
import type { CleanupWindow, PushRepository } from "../../application/ports/push";
import type { PushRegistrationRecord, TaskRecord } from "../../domain/persistence-model";
import { PushRegistrationEntity, RateBucketEntity } from "./entities";

import { DatabaseIdentityRepository } from "./identity-repository";
import { pushTerminal } from "../../application/services/push-lifecycle";

export class MikroOrmPushRepository implements PushRepository {
  constructor(private readonly em: EntityManager) {}
  async sync(task: TaskRecord, now: Date) {
    if (task.kind !== "task" || !task.remoteTaskId) return;
    const terminal = pushTerminal(task.state);
    if (!terminal) await this.em.upsert(PushRegistrationEntity, {
      id: randomUUID(), organizationId: task.organizationId, taskId: task.id, status: "pending", desired: true,
      availableAt: now, attempts: 0, leaseOwner: null, leaseUntil: null, lastError: null,
      rateWindow: now, rateCount: 0, createdAt: now, updatedAt: now,
    }, { onConflictFields: ["taskId"], onConflictAction: "ignore", disableIdentityMap: true });
    if (terminal) {
      const current = await this.findByTaskId(task.organizationId, task.id);
      if (current && current.status !== "deleted") await this.em.nativeUpdate(PushRegistrationEntity,
        { id: current.id, organizationId: task.organizationId }, { desired: false,
          // Do not interrupt an in-flight create: its fenced completion schedules cleanup.
          status: current.status === "registering" ? "registering" : "deleting", availableAt: now, updatedAt: now });
    }
  }
  async adopt(now: Date) {
    await (this.em as SqlEntityManager).execute(`insert into task_push_registrations
      (id, organization_id, task_id, status, desired, available_at, attempts, rate_window, rate_count, created_at, updated_at)
      select gen_random_uuid(), t.organization_id, t.id, 'pending', true, ?, 0, ?, 0, ?, ? from tasks t
      join agents a on a.id = t.agent_id and a.organization_id = t.organization_id
      where a.enabled = true and t.kind = 'task' and t.remote_task_id is not null
      and t.state not in ('TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED')
      on conflict (task_id) do nothing`, [now, now, now, now]);
  }
  async retireDisabled(now: Date) {
    await (this.em as SqlEntityManager).execute(`update task_push_registrations p set desired = false,
      status = case when p.status = 'registering' then 'registering' else 'deleting' end, available_at = ?, updated_at = ?
      from tasks t join agents a on a.id = t.agent_id and a.organization_id = t.organization_id
      where p.task_id = t.id and p.organization_id = t.organization_id and a.enabled = false
      and p.desired = true and p.status <> 'deleted'`, [now, now]);
  }
  async findById(id: string, lock = false) {
    const row = await this.em.findOne(PushRegistrationEntity, { id },
      { refresh: true, ...(lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}) });
    return row ? this.record(row) : undefined;
  }
  async findByTaskId(organizationId: string, taskId: string) {
    const row = await this.em.findOne(PushRegistrationEntity, { organizationId, taskId }, { refresh: true });
    return row ? this.record(row) : undefined;
  }
  async claim(owner: string, now: Date, until: Date) {
    const row = await this.em.findOne(PushRegistrationEntity, {
      availableAt: { $lte: now },
      $or: [{ status: "pending" }, { status: "registering", leaseUntil: { $lte: now } },
        { status: "deleting", $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] }],
    }, { orderBy: { availableAt: "asc", id: "asc" }, lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE, refresh: true });
    if (!row) return undefined;
    this.em.assign(row, { status: row.desired ? "registering" : "deleting", leaseOwner: owner,
      leaseUntil: until, attempts: row.attempts + 1, updatedAt: now });
    await this.em.flush(); return this.record(row);
  }
  async renew(lease: PushRegistrationRecord, now: Date, until: Date) {
    return (await this.em.nativeUpdate(PushRegistrationEntity, this.fence(lease, now), { leaseUntil: until, updatedAt: now })) === 1;
  }
  async finish(lease: PushRegistrationRecord, now: Date, changes: Pick<PushRegistrationRecord, "status" | "availableAt" | "lastError">) {
    const row = await this.em.findOne(PushRegistrationEntity, this.fence(lease, now), { refresh: true, lockMode: LockMode.PESSIMISTIC_WRITE });
    if (!row) return false;
    const final = !row.desired && changes.status !== "deleted" ? { ...changes, status: "deleting" as const } : changes;
    this.em.assign(row, { ...final, leaseOwner: null, leaseUntil: null, updatedAt: now });
    await this.em.flush(); return true;
  }
  async consumeRate(id: string, now: Date, limit: number) {
    const row = await this.em.findOne(PushRegistrationEntity, { id }, { refresh: true, lockMode: LockMode.PESSIMISTIC_WRITE });
    if (!row) return false;
    if (now.getTime() - row.rateWindow.getTime() >= 60_000) { row.rateWindow = now; row.rateCount = 0; }
    if (row.rateCount >= limit) return false;
    row.rateCount++; await this.em.flush(); return true;
  }
  async cleanupAgents(now: Date, window: CleanupWindow, limit: number) {
    const rows = await (this.em as SqlEntityManager).execute(`select distinct t.organization_id, t.agent_id
      from task_push_registrations p join tasks t on t.id = p.task_id and t.organization_id = p.organization_id
      join agents a on a.id = t.agent_id and a.organization_id = t.organization_id
      where a.enabled = true and p.status = 'deleted' and p.updated_at <= ? and p.updated_at > ? limit ?`,
      [window.recheckBefore, window.since, limit]) as Array<{ organization_id: string; agent_id: string }>;
    return rows.map((row) => ({ organizationId: row.organization_id, agentId: row.agent_id }));
  }
  async cleanupBatch(organizationId: string, agentId: string, _now: Date, window: CleanupWindow, limit: number) {
    const rows = await (this.em as SqlEntityManager).execute(`select p.id from task_push_registrations p
      join tasks t on t.id = p.task_id and t.organization_id = p.organization_id
      where p.organization_id = ? and t.agent_id = ? and p.status = 'deleted' and p.updated_at <= ? and p.updated_at > ?
      order by p.updated_at asc, p.id asc limit ?`, [organizationId, agentId, window.recheckBefore, window.since, limit]) as Array<{ id: string }>;
    if (!rows.length) return [];
    const found = await this.em.find(PushRegistrationEntity, { organizationId, id: { $in: rows.map((row) => row.id) } }, { refresh: true });
    const order = new Map(rows.map((row, index) => [row.id, index]));
    return found.map((row) => this.record(row)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }
  async markChecked(organizationId: string, ids: string[], now: Date) {
    if (ids.length) await this.em.nativeUpdate(PushRegistrationEntity, { organizationId, id: { $in: ids } }, { updatedAt: now });
  }
  async claimCleanup(agentId: string, now: Date, intervalMs: number) {
    const id = `push-cleanup:${agentId}`;
    await this.em.upsert(RateBucketEntity, { id, count: 0, expiresAt: new Date(0) }, { onConflictFields: ["id"], onConflictAction: "ignore" });
    const bucket = await this.em.findOneOrFail(RateBucketEntity, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
    if (bucket.expiresAt > now) return false;
    bucket.expiresAt = new Date(now.getTime() + intervalMs); bucket.count += 1;
    await this.em.flush(); return true;
  }
  async auditCleanup(organizationId: string, agentId: string, cleaned: number) {
    await new DatabaseIdentityRepository(this.em).appendSystemAudit(organizationId, `push.cleanup.${cleaned}`, agentId);
  }
  private fence(lease: PushRegistrationRecord, now: Date) {
    return { id: lease.id, organizationId: lease.organizationId, status: lease.status,
      leaseOwner: lease.leaseOwner, leaseUntil: { $gt: now } };
  }
  private record(row: PushRegistrationEntity): PushRegistrationRecord {
    return { id: row.id, organizationId: row.organizationId, taskId: row.taskId, status: row.status,
      desired: row.desired, availableAt: row.availableAt, attempts: row.attempts, leaseOwner: row.leaseOwner ?? null,
      leaseUntil: row.leaseUntil ?? null, lastError: row.lastError ?? null, rateWindow: row.rateWindow,
      rateCount: row.rateCount, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }
}
