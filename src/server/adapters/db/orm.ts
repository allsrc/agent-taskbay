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
import { createPersistenceRepositories } from "./repositories";

type DatabaseGlobal = typeof globalThis & {
  __a2aOpsOrmPromise?: Promise<MikroORM>;
};

const databaseGlobal = globalThis as DatabaseGlobal;

export async function createDatabaseOrm(
  config: DatabaseConfig = loadDatabaseConfig(),
): Promise<MikroORM> {
  const orm = await MikroORM.init(createMikroOrmOptions(config));
  try {
    await orm.connect();
    return orm;
  } catch (error) {
    await orm.close(true).catch(() => undefined);
    throw error;
  }
}

export async function bootstrapRuntimeDatabase(orm: MikroORM) {
  const entityManager = orm.em.fork({ clear: true, useContext: false });
  const repositories = createPersistenceRepositories(entityManager);
  return bootstrapDefaultLocalOrganization(repositories.organizations);
}

async function createRuntimeDatabaseOrm(): Promise<MikroORM> {
  const orm = await createDatabaseOrm();
  try {
    await bootstrapRuntimeDatabase(orm);
    return orm;
  } catch (error) {
    await orm.close(true).catch(() => undefined);
    throw error;
  }
}

export function getDatabaseOrm(): Promise<MikroORM> {
  if (!databaseGlobal.__a2aOpsOrmPromise) {
    const initialization = createRuntimeDatabaseOrm();
    databaseGlobal.__a2aOpsOrmPromise = initialization;
    void initialization.catch(() => {
      if (databaseGlobal.__a2aOpsOrmPromise === initialization) {
        delete databaseGlobal.__a2aOpsOrmPromise;
      }
    });
  }

  return databaseGlobal.__a2aOpsOrmPromise;
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
  const initialization = databaseGlobal.__a2aOpsOrmPromise;
  delete databaseGlobal.__a2aOpsOrmPromise;
  if (initialization) {
    await (await initialization).close(true);
  }
}
