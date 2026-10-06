import type { JsonValue, TaskEventRecord } from "../../domain/persistence-model";
import type { ArtifactStore } from "../ports/artifact-store";
import { createHash } from "node:crypto";
import { eventDigest } from "./event-identity";
import { object } from "./task-projection";

/** Verify archives and recreate content references before activation, outside the task lock. */
export async function restoreArchivedEvent(row: TaskEventRecord, store: ArtifactStore, onBinary?: (digests: string[]) => Promise<void>): Promise<TaskEventRecord> {
  const envelope = object(row.payloadJson);
  const key = envelope.originalEventObjectKey;
  if (typeof key !== "string") return row;
  const [organization, digest, extra] = key.split("/");
  if (organization !== row.organizationId || extra || !/^[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid protocol archive scope.");
  const bytes = await store.get(row.organizationId, digest);
  if (!bytes || createHash("sha256").update(bytes).digest("hex") !== digest) throw new Error("Protocol archive missing or corrupt.");
  let original: JsonValue;
  try { original = JSON.parse(Buffer.from(bytes).toString("utf8")); }
  catch { throw new Error("Protocol archive contains invalid JSON."); }
  if (eventDigest(original) !== row.payloadDigest) throw new Error("Protocol archive event digest mismatch.");
  const restored = await externalizeBinary(original, row.organizationId, store);
  await onBinary?.(restored.binaryDigests);
  const safe = restored.event;
  // User input was archived before being wrapped in its task-scoped Message.
  const previous = object(envelope.event);
  const event = previous.message && !object(safe).message ? {
    message: { ...object(safe), taskId: object(previous.message).taskId, contextId: object(previous.message).contextId },
  } as JsonValue : safe;
  return { ...row, payloadJson: { ...envelope, event } as JsonValue };
}

export async function externalizeBinary(event: JsonValue, organizationId: string, store: ArtifactStore) {
  let changed = false;
  const binaryDigests: string[] = [];
  const visit = async (value: JsonValue, isPart = false): Promise<JsonValue> => {
    if (Array.isArray(value)) return Promise.all(value.map((child) => visit(child, isPart)));
    if (!value || typeof value !== "object") return value;
    const result = { ...value };
    const legacyFile = object(value.file);
    const raw = typeof value.raw === "string" ? value.raw : typeof legacyFile.bytes === "string" ? legacyFile.bytes : undefined;
    if (isPart && raw !== undefined) {
      if (raw.length > 24 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) throw new Error("Invalid or oversized inline binary part.");
      const saved = await store.put(organizationId, Buffer.from(raw, "base64"));
      binaryDigests.push(saved.digest);
      delete result.raw; delete result.file;
      result.url = `/api/artifacts/${saved.digest}`;
      result.mediaType = typeof value.mediaType === "string" ? value.mediaType : typeof legacyFile.mimeType === "string" ? legacyFile.mimeType : "application/octet-stream";
      result.metadata = { ...object(value.metadata), agentTaskbayObject: { objectKey: saved.objectKey, digest: saved.digest, sizeBytes: saved.sizeBytes } } as JsonValue;
      result.filename = typeof value.filename === "string" ? value.filename : typeof legacyFile.name === "string" ? legacyFile.name : "artifact";
      changed = true;
    }
    for (const [key, child] of Object.entries(result)) result[key] = await visit(child, key === "parts");
    return result;
  };
  const safe = await visit(event);
  const original = changed ? await store.put(organizationId, Buffer.from(JSON.stringify(event))) : undefined;
  return { event: safe, originalEventObjectKey: original?.objectKey, binaryDigests };
}
