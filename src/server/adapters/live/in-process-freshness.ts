import { randomUUID } from "node:crypto";
import type { FreshnessReader, RealtimePublisher } from "../../application/ports/realtime";

export class InProcessFreshness implements FreshnessReader, RealtimePublisher {
  private readonly tokens = new Map<string, string>();
  async publish(organizationId: string) { this.tokens.set(organizationId, randomUUID()); }
  async readToken(organizationId: string) { return this.tokens.get(organizationId) ?? ""; }
}

// Next's instrumentation and route bundles must share one local bus, including HMR.
type LiveGlobal = typeof globalThis & { __a2aFreshness?: InProcessFreshness };
export function localFreshness() {
  const state = globalThis as LiveGlobal;
  return state.__a2aFreshness ??= new InProcessFreshness();
}
