import type { MikroORM } from "@mikro-orm/core";
import { withRequestEntityManager } from "../adapters/db/orm";
import { createPersistenceRepositories } from "../adapters/db/repositories";
import { requestAccessPolicy } from "../adapters/db/security-repository";
import { currentPrincipal } from "../adapters/auth/principal-context";
import { authorize } from "../application/services/authorization";
import { extendedCardGateway } from "../adapters/a2a/extended-card-gateway";
import { FetchExtendedCardService } from "../application/services/fetch-extended-card";
import { viewExtendedCard } from "../../lib/extended-card";
import { publicSecurityRateLimit } from "./security";

export async function refreshExtendedCard(agentId: string) {
  const principal = currentPrincipal();
  if (!principal) throw new Error("Sign in to continue.");
  authorize(principal, "administer");
  await publicSecurityRateLimit("extended-card");
  return withRequestEntityManager(async (em) => {
    const snapshot = await new FetchExtendedCardService(createPersistenceRepositories(em).agents, extendedCardGateway)
      .fetch(principal.organizationId, agentId);
    return snapshot ? viewExtendedCard(snapshot.normalizedCardJson, snapshot.fetchedAt) : undefined;
  });
}

export async function readExtendedCard(agentId: string, orm?: MikroORM) {
  const principal = currentPrincipal();
  if (!principal) return undefined;
  return withRequestEntityManager(async (em) => {
    const policy = await requestAccessPolicy(em);
    // Partial skill views must not reveal extra skills the principal has not been granted.
    if (!policy?.allows(agentId, "read")) return undefined;
    const snapshot = await createPersistenceRepositories(em).agents.findLatestExtendedCardSnapshot(principal.organizationId, agentId);
    return snapshot ? viewExtendedCard(snapshot.normalizedCardJson, snapshot.fetchedAt) : undefined;
  }, orm);
}
