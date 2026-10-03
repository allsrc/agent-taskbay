import type { MikroORM } from "@mikro-orm/core";
import { createHash } from "node:crypto";
import type { ArtifactStore } from "../application/ports/artifact-store";
import type { A2APushGateway, PushCredentials, PushUnitOfWork } from "../application/ports/push";
import { PushReceiptError } from "../application/ports/push";
import { PushLifecycleWorker, pushTerminal } from "../application/services/push-lifecycle";
import { PushReceiptService, validatePushEvent } from "../application/services/receive-push";
import { eventDigest } from "../application/services/observe-task";
import { SdkPushGateway } from "../adapters/a2a/push-gateway";
import { createPersistenceRepositories } from "../adapters/db/repositories";
import { withJobEntityManager } from "../adapters/db/orm";
import { createTaskObserver } from "./task-persistence";
import { loadPushCredentials } from "./push-config";
import { redactSecrets } from "../../lib/safe-fetch";
import { EncryptedDatabaseCredentialVault } from "../adapters/db/credential-vault";
import { readJsonRequest } from "../../lib/request-guard";

interface PushOptions { orm?: MikroORM; store?: ArtifactStore; credentials?: PushCredentials }
function pushWork(orm?: MikroORM): PushUnitOfWork {
  return { run: (callback) => withJobEntityManager((em) => em.transactional((tx) => callback(createPersistenceRepositories(tx))), orm) };
}
export function createPushWorker(options: PushOptions & { gateway?: A2APushGateway } = {}) {
  const credentials = options.credentials ?? loadPushCredentials();
  if (!credentials) throw new Error("Push delivery is not configured.");
  return new PushLifecycleWorker(pushWork(options.orm), options.gateway ?? new SdkPushGateway(), credentials);
}
class LatePush extends Error {}

/** Auth runs before body parsing; the transaction rechecks credentials and scope. */
export async function receivePush(id: string, request: Request, options: PushOptions = {}) {
  const credentials = options.credentials ?? loadPushCredentials();
  if (!credentials) throw new PushReceiptError("Push delivery is not configured.", 503);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new PushReceiptError("Invalid push authentication.", 401);
  const authorization = request.headers.get("authorization");
  const { registration, task } = await new PushReceiptService(pushWork(options.orm), credentials).authorize(id, authorization);
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!["application/json", "application/a2a+json"].includes(type ?? "")) throw new PushReceiptError("Push requires a JSON content type.", 415);
  const binding = await withJobEntityManager((em) => new EncryptedDatabaseCredentialVault(em).resolve(task.organizationId, task.agentId), options.orm);
  const serviceSecrets = binding ? Object.entries(binding.credential).filter(([key]) => ["token", "value", "clientSecret", "key", "cert"].includes(key)).map(([, value]) => value as string) : [];
  const event = validatePushEvent(redactSecrets(await readJsonRequest(request),
    [...serviceSecrets, ...(authorization ? [authorization, authorization.replace(/^Bearer /i, "")] : [])]), task);
  const deliveryId = request.headers.get("x-a2a-delivery-id");
  if (deliveryId && (deliveryId.length > 255 || !/^[\x21-\x7e]+$/.test(deliveryId))) throw new PushReceiptError("Invalid push delivery ID.", 400);
  const sourceKey = `push:${registration.id}:${deliveryId ? createHash("sha256").update(deliveryId).digest("hex") : eventDigest(event)}`;
  try {
    await createTaskObserver({ organizationId: task.organizationId, agentId: task.agentId, tenant: task.tenant,
      sessionId: id, requestId: id, source: "webhook" }, {
      ...options, managePush: true, sourceKey, stableSourceIdentity: Boolean(deliveryId),
      beforeObserve: async (tx) => {
        const ports = createPersistenceRepositories(tx);
        const lockedTask = await ports.tasks.getOrCreate(task);
        const locked = await ports.push.findById(id, true);
        const agent = await ports.agents.findById(task.organizationId, task.agentId);
        if (!locked || locked.organizationId !== registration.organizationId || locked.taskId !== task.id ||
          !credentials.authenticate(locked, authorization) || ["deleted", "failed"].includes(locked.status) || !agent?.enabled)
          throw new PushReceiptError("Invalid push authentication.", 401);
        validatePushEvent(event, lockedTask);
        if (pushTerminal(lockedTask.state)) throw new LatePush();
      },
    })(event);
  } catch (error) { if (!(error instanceof LatePush)) throw error; }
}
