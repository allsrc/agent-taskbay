import type { MikroORM } from "@mikro-orm/core";
import { z } from "zod";
import { withRequestEntityManager } from "../adapters/db/orm";
import { createPersistenceRepositories } from "../adapters/db/repositories";
import { DatabaseIdentityRepository } from "../adapters/db/identity-repository";
import type { Principal } from "../application/ports/identity";

/** Per-agent settings an administrator can change. Fields are added as features need them; unknown fields are refused. */
export const agentSettingsSchema = z.object({ extensionOverride: z.boolean().optional() }).strict()
  .refine((value) => Object.keys(value).length > 0, "At least one setting is required.");
export type AgentSettingsChange = z.infer<typeof agentSettingsSchema>;

export class AgentSettingsError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Applies a settings change to one agent of the principal's organization and records who did it. Callers authorize the principal. */
export async function changeAgentSettings(principal: Principal, agentId: string, change: AgentSettingsChange, orm?: MikroORM) {
  await withRequestEntityManager((em) => em.transactional(async (transaction) => {
    const ports = createPersistenceRepositories(transaction);
    const audit = new DatabaseIdentityRepository(transaction);
    if (change.extensionOverride !== undefined) {
      if (!await ports.agents.setExtensionOverride(principal.organizationId, agentId, change.extensionOverride, new Date())) throw new AgentSettingsError("Unknown agent.", 404);
      await audit.appendAudit(principal, change.extensionOverride ? "agent.extension.override" : "agent.extension.override.removed", agentId,
        `extension-override:${agentId}:${crypto.randomUUID()}`);
    }
  }), orm);
}
