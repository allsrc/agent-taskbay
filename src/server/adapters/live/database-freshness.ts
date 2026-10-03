import { randomUUID } from "node:crypto";
import type { MikroORM } from "@mikro-orm/core";
import type { FreshnessReader, RealtimePublisher } from "../../application/ports/realtime";
import { withJobEntityManager } from "../db/orm";

/** Shared polling adapter: worker and web replicas never share an identity map. */
export class DatabaseFreshness implements FreshnessReader, RealtimePublisher {
  constructor(private readonly orm?: MikroORM) {}
  async publish(organizationId: string) {
    await withJobEntityManager((em) => em.getConnection().execute(
      `insert into organization_freshness (organization_id, token) values (?, ?)
       on conflict (organization_id) do update set token = excluded.token`, [organizationId, randomUUID()]), this.orm);
  }
  async readToken(organizationId: string) {
    const rows = await withJobEntityManager((em) => em.getConnection().execute<{ token: string }[]>(
      `select token from organization_freshness where organization_id = ?`, [organizationId]), this.orm);
    return rows[0]?.token ?? "";
  }
}
