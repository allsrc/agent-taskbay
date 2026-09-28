import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * The org's catalog of known A2A agents (design doc §7.2.1). Kept behind an
 * interface so a real directory service can back it later -- this
 * env-seed-plus-JSON-file implementation is a v1 stand-in for that, not a
 * durable multi-instance store (see ROADMAP.md Phase 1).
 */
export interface RegisteredAgent {
  id: string;
  cardUrl: string;
  /** "env" entries come from A2A_REGISTERED_AGENTS and aren't removable from the UI. */
  source: "env" | "managed";
}

export interface AgentRegistry {
  list(): Promise<RegisteredAgent[]>;
  get(id: string): Promise<RegisteredAgent | undefined>;
  add(cardUrl: string): Promise<RegisteredAgent>;
  remove(id: string): Promise<boolean>;
}

export function agentIdFromCardUrl(cardUrl: string): string {
  return createHash("sha256").update(cardUrl).digest("hex").slice(0, 16);
}

function dataFilePath(): string {
  const dir = process.env.A2A_DATA_DIR ? resolve(process.env.A2A_DATA_DIR) : resolve(process.cwd(), ".data");
  return join(dir, "agents.json");
}

function envEntries(): RegisteredAgent[] {
  const raw = process.env.A2A_REGISTERED_AGENTS ?? "";
  return [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))]
    .map((cardUrl) => ({ id: agentIdFromCardUrl(cardUrl), cardUrl, source: "env" as const }));
}

async function readManaged(): Promise<Array<{ cardUrl: string }>> {
  try {
    const content = await readFile(dataFilePath(), "utf8");
    const parsed = JSON.parse(content) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is { cardUrl: string } => Boolean(item) && typeof (item as { cardUrl?: unknown }).cardUrl === "string")
      : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeManaged(entries: Array<{ cardUrl: string }>): Promise<void> {
  const path = dataFilePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(entries, null, 2), "utf8");
}

class FileBackedAgentRegistry implements AgentRegistry {
  async list(): Promise<RegisteredAgent[]> {
    const env = envEntries();
    const envIds = new Set(env.map((entry) => entry.id));
    const managed = await readManaged();
    const managedEntries: RegisteredAgent[] = managed
      .map((item) => ({ id: agentIdFromCardUrl(item.cardUrl), cardUrl: item.cardUrl, source: "managed" as const }))
      .filter((entry) => !envIds.has(entry.id));
    const seen = new Set<string>();
    return [...env, ...managedEntries].filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
  }

  async get(id: string): Promise<RegisteredAgent | undefined> {
    return (await this.list()).find((entry) => entry.id === id);
  }

  async add(cardUrl: string): Promise<RegisteredAgent> {
    const trimmed = cardUrl.trim();
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Agent Card URL must be http(s).");
    }
    const existing = await this.list();
    const id = agentIdFromCardUrl(trimmed);
    const already = existing.find((entry) => entry.id === id);
    if (already) return already;
    const managed = await readManaged();
    await writeManaged([...managed, { cardUrl: trimmed }]);
    return { id, cardUrl: trimmed, source: "managed" };
  }

  async remove(id: string): Promise<boolean> {
    const managed = await readManaged();
    const next = managed.filter((item) => agentIdFromCardUrl(item.cardUrl) !== id);
    if (next.length === managed.length) return false;
    await writeManaged(next);
    return true;
  }
}

let registry: AgentRegistry | undefined;

export function agentRegistry(): AgentRegistry {
  registry ??= new FileBackedAgentRegistry();
  return registry;
}
