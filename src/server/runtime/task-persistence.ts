import { randomUUID } from "node:crypto";
import type { MikroORM } from "@mikro-orm/core";
import type { ArtifactStore } from "../application/ports/artifact-store";
import { ObserveTaskService, eventDigest } from "../application/services/observe-task";
import { TaskQueryService } from "../application/services/task-query";
import { eventSubject, object } from "../application/services/task-projection";
import { bootstrapDefaultLocalOrganization } from "../application/services/bootstrap-default-organization";
import { FilesystemArtifactStore } from "../adapters/blob/filesystem-artifact-store";
import { createPersistenceRepositories } from "../adapters/db/repositories";
import { withRequestEntityManager } from "../adapters/db/orm";
import type { JsonValue, TaskEventSource } from "../domain/persistence-model";

export const artifactStore = new FilesystemArtifactStore();

export async function withTaskQueries<T>(work: (queries: TaskQueryService, organizationId: string) => Promise<T>, orm?: MikroORM) {
  return withRequestEntityManager(async (em) => {
    const repositories = createPersistenceRepositories(em);
    const organization = await bootstrapDefaultLocalOrganization(repositories.organizations);
    return work(new TaskQueryService(repositories.tasks, repositories.agents), organization.id);
  }, orm);
}

async function externalizeBinary(event: JsonValue, organizationId: string, store: ArtifactStore) {
  let changed = false;
  const visit = async (value: JsonValue, isPart = false): Promise<JsonValue> => {
    if (Array.isArray(value)) return Promise.all(value.map((child) => visit(child, isPart)));
    if (!value || typeof value !== "object") return value;
    const result = { ...value };
    const legacyFile = object(value.file);
    const raw = typeof value.raw === "string" ? value.raw : typeof legacyFile.bytes === "string" ? legacyFile.bytes : undefined;
    if (isPart && raw !== undefined) {
      if (raw.length > 24 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) throw new Error("Invalid or oversized inline binary part.");
      const saved = await store.put(organizationId, Buffer.from(raw, "base64"));
      delete result.raw; delete result.file;
      result.url = `/api/artifacts/${saved.digest}`;
      result.mediaType = typeof value.mediaType === "string" ? value.mediaType : typeof legacyFile.mimeType === "string" ? legacyFile.mimeType : "application/octet-stream";
      result.filename = typeof value.filename === "string" ? value.filename : typeof legacyFile.name === "string" ? legacyFile.name : "artifact";
      changed = true;
    }
    for (const [key, child] of Object.entries(result)) result[key] = await visit(child, key === "parts");
    return result;
  };
  const safe = await visit(event);
  const original = changed ? await store.put(organizationId, Buffer.from(JSON.stringify(event))) : undefined;
  return { event: safe, originalEventObjectKey: original?.objectKey };
}

export interface ObservationSession {
  agentId: string;
  tenant?: string;
  sessionId: string;
  requestId: string;
  userMessage?: JsonValue;
  source?: TaskEventSource;
}

/** Browser-triggered streams remain temporary writers until the Phase 2 worker. */
export function createTaskObserver(session: ObservationSession, options: { orm?: MikroORM; store?: ArtifactStore } = {}) {
  const occurrences = new Map<string, number>();
  const directThreadId = randomUUID();
  return async (event: JsonValue) => withRequestEntityManager(async (em) => {
    const repositories = createPersistenceRepositories(em);
    const organization = await bootstrapDefaultLocalOrganization(repositories.organizations);
    const archived = await externalizeBinary(event, organization.id, options.store ?? artifactStore);
    const user = session.userMessage ? await externalizeBinary(session.userMessage, organization.id, options.store ?? artifactStore) : undefined;
    const digest = eventDigest(event);
    const { kind, subject } = eventSubject(event);
    const ordinal = subject.append === true ? (occurrences.get(digest) ?? 0) : 0;
    occurrences.set(digest, ordinal + 1);
    return em.transactional(async (transaction) => {
      const ports = createPersistenceRepositories(transaction);
      const service = new ObserveTaskService(ports.agents, ports.tasks, ports.taskEvents);
      return service.observe({
        ...session, organizationId: organization.id, tenant: session.tenant ?? "",
        event: archived.event, originalEventObjectKey: archived.originalEventObjectKey,
        payloadDigest: digest, source: session.source ?? "stream", sourceKey: `${kind}:${digest}:${ordinal}`,
        directThreadId, userMessage: user?.event,
        userMessagePayloadDigest: session.userMessage ? eventDigest(session.userMessage) : undefined,
        userMessageOriginalObjectKey: user?.originalEventObjectKey,
      });
    });
  }, options.orm);
}
