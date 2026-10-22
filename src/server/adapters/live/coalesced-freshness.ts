import type { FreshnessReader } from "../../application/ports/realtime";

type Entry = { at: number; token?: string; reading?: Promise<string> };

/**
 * Shares token reads between streams: every open stream polls, but the database sees at most one
 * read per organization per `ttlMs` in this process. Idle organizations cost nothing.
 */
export class CoalescedFreshnessReader implements FreshnessReader {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly source: FreshnessReader, private readonly ttlMs = 400, private readonly now = Date.now) {}

  readToken(organizationId: string): Promise<string> {
    const entry = this.entries.get(organizationId);
    if (entry?.reading) return entry.reading;
    if (entry?.token !== undefined && this.now() - entry.at < this.ttlMs) return Promise.resolve(entry.token);
    this.prune();
    const next: Entry = { at: entry?.at ?? 0 };
    const reading = this.source.readToken(organizationId).then((token) => {
      next.token = token; next.at = this.now(); next.reading = undefined;
      return token;
    }, (error) => {
      this.entries.delete(organizationId); // A failure is never cached; the next caller retries.
      throw error;
    });
    next.reading = reading;
    this.entries.set(organizationId, next);
    return reading;
  }

  private prune() {
    if (this.entries.size < 256) return;
    for (const [key, entry] of this.entries) if (!entry.reading && this.now() - entry.at >= this.ttlMs) this.entries.delete(key);
  }
}
