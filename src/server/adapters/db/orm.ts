import {
  MikroORM,
  RequestContext,
  type EntityManager,
} from "@mikro-orm/core";

import { bootstrapDefaultLocalOrganization } from "../../application/services/bootstrap-default-organization";
import {
  createMikroOrmOptions,
  loadDatabaseConfig,
  type DatabaseConfig,
} from "./config";
import { migrateOnStartup } from "./migration-startup";
import { claimPgliteDirectory, openGuarded, releasePgliteDirectory } from "./pglite-guard";
import { createPersistenceRepositories } from "./repositories";

type DatabaseGlobal = typeof globalThis & {
  __agentTaskbayOrmPromise?: Promise<MikroORM>;
};

const databaseGlobal = globalThis as DatabaseGlobal;

export async function createDatabaseOrm(
  config: DatabaseConfig = loadDatabaseConfig(),
): Promise<MikroORM> {
  const open = async () => {
    const orm = await MikroORM.init(createMikroOrmOptions(config));
    try {
      await orm.connect();
      return orm;
    } catch (error) {
      await orm.close(true).catch(() => undefined);
      throw error;
    }
  };
  if (config.profile !== "pglite") return open();
  // The claim lasts as long as the database is open, so a process that closes it can hand the folder to another one.
  claimPgliteDirectory(config.dataDir);
  try {
    const orm = await openGuarded(config.dataDir, open);
    const close = orm.close.bind(orm);
    let released = false;
    orm.close = async (...args: Parameters<typeof close>) => {
      try { return await close(...args); } finally { if (!released) { released = true; releasePgliteDirectory(config.dataDir); } }
    };
    return orm;
  } catch (error) {
    releasePgliteDirectory(config.dataDir);
    throw error;
  }
}

export async function bootstrapRuntimeDatabase(orm: MikroORM) {
  const entityManager = orm.em.fork({ clear: true, useContext: false });
  const repositories = createPersistenceRepositories(entityManager);
  return bootstrapDefaultLocalOrganization(repositories.organizations);
}

/**
 * ADR 0025. The local launcher and `next dev` own a single-process PGlite directory, so they migrate in place. Multi-replica
 * PostgreSQL deployments keep migration as an explicit step unless an operator opts in with A2A_AUTO_MIGRATE=true.
 */
export function shouldAutoMigrate(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (environment.A2A_AUTO_MIGRATE !== undefined && environment.A2A_AUTO_MIGRATE !== "") return environment.A2A_AUTO_MIGRATE === "true";
  return environment.NODE_ENV === "development" && (environment.A2A_DATABASE_PROFILE ?? "pglite") === "pglite";
}

async function createRuntimeDatabaseOrm(): Promise<MikroORM> {
  const config = loadDatabaseConfig();
  let orm = await createDatabaseOrm(config);
  try {
    if (shouldAutoMigrate()) orm = await migrateOnStartup(orm, config, () => createDatabaseOrm(config));
    await bootstrapRuntimeDatabase(orm);
    return orm;
  } catch (error) {
    await orm.close(true).catch(() => undefined);
    throw error;
  }
}

export function getDatabaseOrm(): Promise<MikroORM> {
  if (!databaseGlobal.__agentTaskbayOrmPromise) {
    const initialization = createRuntimeDatabaseOrm();
    databaseGlobal.__agentTaskbayOrmPromise = initialization;
    void initialization.catch(() => {
      if (databaseGlobal.__agentTaskbayOrmPromise === initialization) {
        delete databaseGlobal.__agentTaskbayOrmPromise;
      }
    });
  }

  return databaseGlobal.__agentTaskbayOrmPromise;
}

export async function withRequestEntityManager<T>(
  work: (entityManager: EntityManager) => T | Promise<T>,
  orm?: MikroORM,
): Promise<T> {
  const database = orm ?? (await getDatabaseOrm());
  return RequestContext.create(database.em, () => {
    const entityManager = RequestContext.getEntityManager();
    if (!entityManager) {
      throw new Error("Request EntityManager context was not created");
    }
    return work(entityManager);
  });
}

export async function withJobEntityManager<T>(
  work: (entityManager: EntityManager) => T | Promise<T>,
  orm?: MikroORM,
): Promise<T> {
  const database = orm ?? (await getDatabaseOrm());
  const entityManager = database.em.fork({ clear: true, useContext: false });
  try {
    return await work(entityManager);
  } finally {
    entityManager.clear();
  }
}

export async function closeDatabaseOrm(): Promise<void> {
  const initialization = databaseGlobal.__agentTaskbayOrmPromise;
  delete databaseGlobal.__agentTaskbayOrmPromise;
  if (initialization) {
    await (await initialization).close(true);
  }
}
