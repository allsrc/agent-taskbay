import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { MikroORM } from "@mikro-orm/core";

import type { AgentRegistry, AgentDiscoverySnapshot } from "../../application/ports/agent-registry";
import { AgentCatalogService } from "../../application/services/agent-catalog";
import { bootstrapDefaultLocalOrganization } from "../../application/services/bootstrap-default-organization";
import { withRequestEntityManager } from "./orm";
import { createPersistenceRepositories } from "./repositories";

/** The legacy file is read for import only and is never overwritten. */
export async function readLegacyAgentUrls(filePath: string): Promise<string[]> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const parsed: unknown = JSON.parse(content);
  if (!Array.isArray(parsed) || parsed.some((entry) =>
    !entry || typeof entry !== "object" || typeof entry.cardUrl !== "string")) {
    throw new Error("Legacy agents.json must be an array of entries with cardUrl strings.");
  }
  return parsed.map((entry: { cardUrl: string }) => entry.cardUrl);
}

interface RegistryOptions {
  orm?: MikroORM;
  legacyFilePath?: string;
  environmentUrls?: () => string[];
}

export class DatabaseAgentRegistry implements AgentRegistry {
  private importPromise?: Promise<void>;

  constructor(private readonly options: RegistryOptions = {}) {}

  private environmentUrls() {
    return this.options.environmentUrls?.() ??
      (process.env.A2A_REGISTERED_AGENTS ?? "").split(",").map((url) => url.trim()).filter(Boolean);
  }

  private async withCatalog<T>(work: (catalog: AgentCatalogService) => Promise<T>) {
    return withRequestEntityManager((entityManager) => entityManager.transactional(async (transaction) => {
      const repositories = createPersistenceRepositories(transaction);
      const organization = await bootstrapDefaultLocalOrganization(repositories.organizations);
      const catalog = new AgentCatalogService(repositories.agents, organization.id, this.environmentUrls());
      await catalog.seedEnvironment();
      return work(catalog);
    }), this.options.orm);
  }

  private async ensureImported() {
    if (!this.importPromise) {
      const attempt = (async () => {
        const filePath = this.options.legacyFilePath ?? join(
          // Runtime operator data must not be bundled into the server output.
          resolve(/* turbopackIgnore: true */ process.env.A2A_DATA_DIR || join(process.cwd(), ".data")), "agents.json",
        );
        const urls = await readLegacyAgentUrls(filePath);
        await this.withCatalog((catalog) => catalog.importLegacy(urls));
      })();
      this.importPromise = attempt;
      void attempt.catch(() => {
        if (this.importPromise === attempt) this.importPromise = undefined;
      });
    }
    await this.importPromise;
  }

  private async execute<T>(work: (catalog: AgentCatalogService) => Promise<T>) {
    await this.ensureImported();
    return this.withCatalog(work);
  }

  list() { return this.execute((catalog) => catalog.list()); }
  get(id: string) { return this.execute((catalog) => catalog.get(id)); }
  add(cardUrl: string) { return this.execute((catalog) => catalog.add(cardUrl)); }
  remove(id: string) { return this.execute((catalog) => catalog.remove(id)); }
  recordDiscovery(id: string, snapshot: AgentDiscoverySnapshot) {
    return this.execute((catalog) => catalog.recordDiscovery(id, snapshot));
  }
}
