import { requestAccessPolicy } from "./security-repository";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { MikroORM, EntityManager } from "@mikro-orm/core";

import type { AgentRegistry, AgentDiscoverySnapshot } from "../../application/ports/agent-registry";
import { AgentCatalogService } from "../../application/services/agent-catalog";
import { bootstrapDefaultLocalOrganization } from "../../application/services/bootstrap-default-organization";
import { withRequestEntityManager } from "./orm";
import { createPersistenceRepositories } from "./repositories";
import { currentPrincipal } from "../auth/principal-context";
import { authorize } from "../../application/services/authorization";
import { DatabaseIdentityRepository } from "./identity-repository";

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

  private async withCatalog<T>(work: (catalog: AgentCatalogService, transaction: EntityManager) => Promise<T>) {
    return withRequestEntityManager((entityManager) => entityManager.transactional(async (transaction) => {
      const repositories = createPersistenceRepositories(transaction);
      const principal = currentPrincipal();
      const organization = principal ? await repositories.organizations.findById(principal.organizationId) :
        await bootstrapDefaultLocalOrganization(repositories.organizations);
      if (!organization) throw new Error("Unknown catalog organization.");
      // Environment and legacy seeds belong only to the bootstrap local organization.
      const catalog = new AgentCatalogService(repositories.agents, organization.id, organization.slug === "local" ? this.environmentUrls() : []);
      await catalog.seedEnvironment();
      return work(catalog, transaction);
    }), this.options.orm);
  }

  private async ensureImported() {
    if (currentPrincipal()) {
      const principal = currentPrincipal()!;
      const local = await withRequestEntityManager((em) => createPersistenceRepositories(em).organizations.findById(principal.organizationId), this.options.orm);
      if (local?.slug !== "local") return;
    }
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

  private async execute<T>(work: (catalog: AgentCatalogService, transaction: EntityManager) => Promise<T>) {
    await this.ensureImported();
    return this.withCatalog(work);
  }

  list() { return this.execute(async (catalog, tx) => {
    const policy = await requestAccessPolicy(tx);
    return (await catalog.list()).filter((agent) => !policy || policy.discovers(agent.id));
  }); }
  get(id: string) { return this.execute(async (catalog, tx) => {
    const agent = await catalog.get(id);
    const policy = await requestAccessPolicy(tx);
    return agent && (!policy || policy.discovers(agent.id)) ? agent : undefined;
  }); }
  async add(cardUrl: string) {
    const principal = currentPrincipal();
    if (principal) authorize(principal, "administer");
    return this.execute(async (catalog, transaction) => {
      const agent = await catalog.add(cardUrl);
      if (principal) await new DatabaseIdentityRepository(transaction).appendAudit(principal, "agent.registered", agent.id);
      return agent;
    });
  }
  async remove(id: string) {
    const principal = currentPrincipal();
    if (principal) authorize(principal, "administer");
    return this.execute(async (catalog, transaction) => {
      const agent = await catalog.get(id);
      const removed = await catalog.remove(id);
      if (removed && principal) await new DatabaseIdentityRepository(transaction).appendAudit(principal, "agent.removed", agent!.id);
      return removed;
    });
  }
  recordDiscovery(id: string, snapshot: AgentDiscoverySnapshot) {
    return this.execute((catalog) => catalog.recordDiscovery(id, snapshot));
  }
}
