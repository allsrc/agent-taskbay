import type { MikroORM } from "@mikro-orm/core";
import type { RealtimePublisher } from "../application/ports/realtime";
import { FreshnessDispatcher } from "../application/services/task-freshness";
import { DatabaseFreshness } from "../adapters/live/database-freshness";
import { CoalescedFreshnessReader } from "../adapters/live/coalesced-freshness";
import { localFreshness } from "../adapters/live/in-process-freshness";
import { loadDatabaseConfig } from "../adapters/db/config";
import { withJobEntityManager } from "../adapters/db/orm";
import { createPersistenceRepositories } from "../adapters/db/repositories";

export function runtimeFreshness() {
  return loadDatabaseConfig().profile === "pglite" ? localFreshness() : new DatabaseFreshness();
}

// One shared reader per process (surviving HMR) so open streams share database reads.
type SharedGlobal = typeof globalThis & { __a2aSharedFreshness?: CoalescedFreshnessReader };
export function liveFreshnessReader() {
  if (loadDatabaseConfig().profile === "pglite") return localFreshness();
  const state = globalThis as SharedGlobal;
  return state.__a2aSharedFreshness ??= new CoalescedFreshnessReader(new DatabaseFreshness());
}

export function createFreshnessDispatcher(options: { orm?: MikroORM; publisher?: RealtimePublisher } = {}) {
  return new FreshnessDispatcher({ run: (work) => withJobEntityManager((em) => em.transactional((tx) =>
    work(createPersistenceRepositories(tx).outbox)), options.orm) }, options.publisher ?? runtimeFreshness());
}
