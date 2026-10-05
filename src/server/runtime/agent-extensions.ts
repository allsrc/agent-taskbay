import { withRequestEntityManager } from "../adapters/db/orm";
import { createPersistenceRepositories } from "../adapters/db/repositories";

/** Extension URIs the agent's latest discovered card advertises. */
export async function advertisedExtensionUris(agentId: string): Promise<string[]> {
  return withRequestEntityManager(async (em) => {
    const snapshot = await createPersistenceRepositories(em).agents.findLatestCardSnapshot(agentId);
    const card = snapshot?.normalizedCardJson as { capabilities?: { extensions?: Array<{ uri?: unknown }> } } | undefined;
    return (card?.capabilities?.extensions ?? []).map((extension) => extension.uri).filter((uri): uri is string => typeof uri === "string");
  });
}
