import { externalizeBinary } from "../application/services/protocol-archive";
import { loadPushCredentials } from "./push-config";
import { randomUUID } from "node:crypto";
import type { MikroORM, EntityManager } from "@mikro-orm/core";
import type { DurableTaskView } from "../../shared/task-types";
import type { ArtifactStore } from "../application/ports/artifact-store";
import { ObserveTaskService, eventDigest } from "../application/services/observe-task";
import { TaskQueryService } from "../application/services/task-query";
import { eventSubject } from "../application/services/task-projection";
import { bootstrapDefaultLocalOrganization } from "../application/services/bootstrap-default-organization";
import { FilesystemArtifactStore } from "../adapters/blob/filesystem-artifact-store";
import { createPersistenceRepositories } from "../adapters/db/repositories";
import { withRequestEntityManager } from "../adapters/db/orm";
import type { JsonValue, TaskEventSource } from "../domain/persistence-model";
import type { StreamMetadata } from "../application/ports/subscriptions";

export const artifactStore = new FilesystemArtifactStore();

export async function withTaskQueries<T>(work: (queries: TaskQueryService, organizationId: string) => Promise<T>, orm?: MikroORM) {
  return withRequestEntityManager(async (em) => {
    const repositories = createPersistenceRepositories(em);
    const organization = await bootstrapDefaultLocalOrganization(repositories.organizations);
    return work(new TaskQueryService(repositories.tasks, repositories.agents), organization.id);
  }, orm);
}

export interface ObservationSession {
  organizationId?: string;
  agentId: string;
  tenant?: string;
  sessionId: string;
  requestId: string;
  userMessage?: JsonValue;
  source?: TaskEventSource;
  streamMetadata?: StreamMetadata;
}

/** Shared command/worker ingestion adapter; callers never persist browser events. */
export function createTaskObserver(session: ObservationSession, options: {
  orm?: MikroORM; store?: ArtifactStore;
  manageSubscription?: boolean;
  managePush?: boolean;
  sourceKey?: string;
  stableSourceIdentity?: boolean;
  beforeObserve?: (transaction: EntityManager) => Promise<void>;
  onObserved?: (view: DurableTaskView, event: JsonValue, transaction: EntityManager) => Promise<void>;
} = {}) {
  const occurrences = new Map<string, number>();
  const directThreadId = randomUUID();
  return async (event: JsonValue) => withRequestEntityManager(async (em) => {
    const repositories = createPersistenceRepositories(em);
    const organization = session.organizationId ? await repositories.organizations.findById(session.organizationId) :
      await bootstrapDefaultLocalOrganization(repositories.organizations);
    if (!organization) throw new Error("Unknown observation organization.");
    const archived = await externalizeBinary(event, organization.id, options.store ?? artifactStore);
    const user = session.userMessage ? await externalizeBinary(session.userMessage, organization.id, options.store ?? artifactStore) : undefined;
    const digest = eventDigest(event);
    const { kind, subject } = eventSubject(event);
    const ordinal = subject.append === true ? (occurrences.get(digest) ?? 0) : 0;
    occurrences.set(digest, ordinal + 1);
    return em.transactional(async (transaction) => {
      await options.beforeObserve?.(transaction);
      const ports = createPersistenceRepositories(transaction);
      const service = new ObserveTaskService(ports.agents, ports.tasks, ports.taskEvents);
      const view = await service.observe({
        ...session, organizationId: organization.id, tenant: session.tenant ?? "",
        event: archived.event, originalEventObjectKey: archived.originalEventObjectKey,
        payloadDigest: digest, source: session.source ?? "stream", stableSourceIdentity: options.stableSourceIdentity,
        // A new send/reply is a new observation even if the peer repeats an
        // identical untimestamped snapshot. Retries of that command stay stable.
        sourceKey: options.sourceKey ?? `${kind}:${digest}:${ordinal}${session.source === "command_response" && session.userMessage ? `:command:${session.requestId}` : ""}`,
        directThreadId, userMessage: user?.event,
        userMessagePayloadDigest: session.userMessage ? eventDigest(session.userMessage) : undefined,
        userMessageOriginalObjectKey: user?.originalEventObjectKey,
      });
      await options.onObserved?.(view, archived.event, transaction);
      if (options.manageSubscription !== false) {
        const task = await ports.tasks.findById(organization.id, view.localId);
        if (task) await ports.subscriptions.sync(task, new Date());
      }
      if (options.managePush ?? Boolean(loadPushCredentials())) {
        const task = await ports.tasks.findById(organization.id, view.localId);
        if (task) await ports.push.sync(task, new Date());
      }
      const reconciled = await ports.tasks.findById(organization.id, view.localId);
      if (reconciled) await ports.syncCursors.sync(reconciled, new Date());
      return view;
    });
  }, options.orm);
}
