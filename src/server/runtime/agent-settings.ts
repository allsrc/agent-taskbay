import type { MikroORM } from "@mikro-orm/core";
import { z } from "zod";
import { withRequestEntityManager } from "../adapters/db/orm";
import { createPersistenceRepositories } from "../adapters/db/repositories";
import { DatabaseIdentityRepository } from "../adapters/db/identity-repository";
import { requestAccessPolicy } from "../adapters/db/security-repository";
import type { Principal } from "../application/ports/identity";
import { DEFAULT_TASK_DISCOVERY_HISTORY_DAYS, DEFAULT_TASK_DISCOVERY_MODE, MAX_TASK_DISCOVERY_HISTORY_DAYS, TASK_DISCOVERY_MODES, effectiveTaskDiscovery,
  type TaskDiscoveryMode } from "../domain/discovery-mode";
import { assertNicknameFree, NicknameTakenError, normalizeNickname } from "../domain/agent-label";
import { taskDiscoveryCap } from "./runtime-config";
import { startAutomaticDiscovery } from "./discovery-cursors";

/** Per-agent settings an administrator can change. Fields are added as features need them; unknown fields are refused. */
export const agentSettingsSchema = z.object({
  extensionOverride: z.boolean().optional(),
  /** Empty or null clears it. */
  nickname: z.string().max(100).nullable().optional(),
  taskDiscovery: z.enum(TASK_DISCOVERY_MODES as [TaskDiscoveryMode, ...TaskDiscoveryMode[]]).optional(),
  taskDiscoveryHistoryDays: z.number().int().min(0).max(MAX_TASK_DISCOVERY_HISTORY_DAYS).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one setting is required.");
export type AgentSettingsChange = z.infer<typeof agentSettingsSchema>;

export class AgentSettingsError extends Error {
  constructor(message: string, readonly status: number, readonly kind?: string) { super(message); }
}

const rank: Record<TaskDiscoveryMode, number> = { off: 0, browse: 1, auto: 2 };

/** Applies a settings change to one agent of the principal's organization and records who did it. Callers authorize the principal. */
export async function changeAgentSettings(principal: Principal, agentId: string, change: AgentSettingsChange, orm?: MikroORM) {
  await withRequestEntityManager((em) => em.transactional(async (transaction) => {
    const ports = createPersistenceRepositories(transaction);
    const audit = new DatabaseIdentityRepository(transaction);
    const agent = await ports.agents.findById(principal.organizationId, agentId);
    if (!agent) throw new AgentSettingsError("Unknown agent.", 404);
    const now = new Date();
    if (change.nickname !== undefined) {
      let nickname: string | null;
      try {
        nickname = normalizeNickname(change.nickname);
        if (nickname) assertNicknameFree(await ports.agents.listByOrganization(principal.organizationId), agentId, nickname);
      } catch (error) {
        throw new AgentSettingsError(error instanceof Error ? error.message : "Invalid nickname.", error instanceof NicknameTakenError ? 409 : 400, error instanceof NicknameTakenError ? "nickname_taken" : undefined);
      }
      await ports.agents.setNickname(principal.organizationId, agentId, nickname, now);
      await audit.appendAudit(principal, nickname ? "agent.nickname.set" : "agent.nickname.cleared", agentId, `agent-nickname:${agentId}:${crypto.randomUUID()}`);
    }
    if (change.extensionOverride !== undefined) {
      await ports.agents.setExtensionOverride(principal.organizationId, agentId, change.extensionOverride, now);
      await audit.appendAudit(principal, change.extensionOverride ? "agent.extension.override" : "agent.extension.override.removed", agentId,
        `extension-override:${agentId}:${crypto.randomUUID()}`);
    }
    if (change.taskDiscovery !== undefined || change.taskDiscoveryHistoryDays !== undefined) {
      const cap = taskDiscoveryCap();
      if (change.taskDiscovery !== undefined && rank[change.taskDiscovery] > rank[cap])
        throw new AgentSettingsError(`This deployment allows task discovery up to “${cap}” (A2A_TASK_DISCOVERY).`, 409, "discovery_capped");
      const enteringAuto = change.taskDiscovery === "auto" && agent.taskDiscovery !== "auto";
      const mode = change.taskDiscovery ?? agent.taskDiscovery ?? DEFAULT_TASK_DISCOVERY_MODE;
      await ports.agents.setTaskDiscovery(principal.organizationId, agentId, {
        ...(change.taskDiscovery !== undefined ? { taskDiscovery: change.taskDiscovery } : {}),
        ...(change.taskDiscoveryHistoryDays !== undefined ? { taskDiscoveryHistoryDays: change.taskDiscoveryHistoryDays } : {}),
        // Entering automatic mode clears a pause left by its limit.
        ...(enteringAuto ? { taskDiscoveryPausedReason: null } : {}),
      }, now);
      // Switching automatic discovery on gives the worker something to claim, and restarts anything that had stopped.
      if (enteringAuto) await startAutomaticDiscovery(transaction, principal.organizationId, agentId, true);
      if (change.taskDiscovery !== undefined && change.taskDiscovery !== (agent.taskDiscovery ?? DEFAULT_TASK_DISCOVERY_MODE))
        await audit.appendAudit(principal, `task.discovery.mode_changed.${mode}`, agentId, `discovery-mode:${agentId}:${crypto.randomUUID()}`);
    }
  }), orm);
}

export type DiscoveryListing = "supported" | "unsupported" | "unknown";
export interface DiscoveryStatus {
  mode: TaskDiscoveryMode;
  effectiveMode: TaskDiscoveryMode;
  /** The highest mode this deployment allows (`A2A_TASK_DISCOVERY`). */
  cap: TaskDiscoveryMode;
  historyDays: number;
  pausedReason: string | null;
  listing: DiscoveryListing;
  /** Automatic discovery only; null in the other modes. */
  auto: { lastCheckedAt: string | null; lastFullSweepAt: string | null; foundTotal: number } | null;
  /** Whether the caller may browse and track this agent's tasks now. */
  canBrowse: boolean;
}

/** What an agent's task discovery is doing, for the agent page. Contains no agent-supplied text. */
export async function readDiscoveryStatus(principal: Principal, agentId: string, orm?: MikroORM): Promise<DiscoveryStatus | undefined> {
  return withRequestEntityManager(async (em) => {
    const ports = createPersistenceRepositories(em);
    const agent = await ports.agents.findById(principal.organizationId, agentId);
    if (!agent?.enabled) return undefined;
    const policy = await requestAccessPolicy(em);
    const cap = taskDiscoveryCap();
    const mode = agent.taskDiscovery ?? DEFAULT_TASK_DISCOVERY_MODE;
    const effectiveMode = effectiveTaskDiscovery(mode, cap);
    const cursors = await ports.syncCursors.listCursors(principal.organizationId, agentId);
    const latest = (values: Array<Date | null>) => values.filter((value): value is Date => value !== null).sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() ?? null;
    const listing: DiscoveryListing = cursors.some((cursor) => cursor.status === "unsupported") ? "unsupported" : cursors.some((cursor) => cursor.lastSyncedAt) ? "supported" : "unknown";
    const mayOperate = ["admin", "operator"].includes(principal.role) && (!policy || policy.allows(agentId, "operate", null));
    return {
      mode, effectiveMode, cap, historyDays: agent.taskDiscoveryHistoryDays ?? DEFAULT_TASK_DISCOVERY_HISTORY_DAYS, pausedReason: agent.taskDiscoveryPausedReason ?? null, listing,
      auto: effectiveMode === "auto" ? { lastCheckedAt: latest(cursors.map((cursor) => cursor.lastSyncedAt ?? null)), lastFullSweepAt: latest(cursors.map((cursor) => cursor.lastFullSweepAt ?? null)),
        foundTotal: await ports.tasks.countDiscovered(principal.organizationId, agentId) } : null,
      canBrowse: effectiveMode !== "off" && mayOperate,
    };
  }, orm);
}
