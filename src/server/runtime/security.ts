import { randomUUID } from "node:crypto";
import type { MikroORM } from "@mikro-orm/core";
import { withRequestEntityManager } from "../adapters/db/orm";
import { ArtifactAccessEntity, TaskEntity, AgentEntity } from "../adapters/db/entities";
import { requestAccessPolicy, taskAccessFilter, takeRateLimit } from "../adapters/db/security-repository";
import { agentConnection } from "../adapters/a2a/agent-connection";
import type { RegisteredAgent } from "../application/ports/agent-registry";
import { currentPrincipal } from "../adapters/auth/principal-context";

export async function registeredAgentConnection(agent: RegisteredAgent) {
  return withRequestEntityManager(async (em) => {
    const principal = currentPrincipal();
    const row = await em.findOne(AgentEntity, {id: agent.id, ...(principal ? {organizationId: principal.organizationId} : {})});
    if (!row?.enabled || row.cardUrl !== agent.cardUrl) throw new Error("Unknown agent.");
    return agentConnection(row);
  });
}
export async function filterAgentCard(agentId: string, card: Record<string, unknown>) {
  return withRequestEntityManager(async (em) => (await requestAccessPolicy(em))?.filterCard(agentId, card) ?? card);
}
export async function authorizedArtifact(organizationId: string, digest: string, orm?: MikroORM) {
  return withRequestEntityManager(async (em) => {
    const links = await em.find(ArtifactAccessEntity, {organizationId, digest});
    const visible = links.length ? await em.findOne(TaskEntity, {organizationId, id: {$in: links.map((link) => link.taskId)},
      $and: [await taskAccessFilter(em)] }) : undefined;
    return Boolean(visible);
  }, orm);
}
export async function recordArtifactAccess(organizationId: string, taskId: string, digests: string[], orm?: MikroORM) {
  return withRequestEntityManager(async (em) => {
    for (const digest of digests) await em.upsert(ArtifactAccessEntity, {id: randomUUID(), organizationId, taskId, digest},
      {onConflictFields: ["taskId", "digest"], onConflictAction: "ignore"});
  }, orm);
}
export async function publicSecurityRateLimit(scope: "login" | "callback" | "webhook") {
  return withRequestEntityManager((em) => takeRateLimit(em, `public:${scope}`, scope === "webhook" ? 1200 : 240));
}
