import { createHash } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { JsonValue, TaskRecord } from "../../domain/persistence-model";
import type { DurableTaskView } from "../../../shared/task-types";
import { ArtifactProjectionEntity, MessageProjectionEntity, TaskProjectionEntity } from "./entities";

/** Caller holds the task lock and transaction; replacement and pointer switch commit together. */
export async function replaceContentProjection(em: EntityManager, task: TaskRecord) {
  const view = task.contentJson as unknown as DurableTaskView;
  const scope = { organizationId: task.organizationId, taskId: task.id, projectionVersion: task.projectionVersion! };
  await em.nativeDelete(MessageProjectionEntity, scope);
  await em.nativeDelete(ArtifactProjectionEntity, scope);
  await em.nativeDelete(TaskProjectionEntity, scope);
  const { messages, artifacts, ...header } = view;
  const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value));
  const identity = (kind: string, remoteId = "") => {
    const hex = createHash("sha256").update(JSON.stringify([task.id, task.projectionVersion, kind, remoteId])).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  em.persist(em.create(TaskProjectionEntity, { id: identity("task"), ...scope, headerJson: json(header) }));
  for (const [position, message] of messages.entries()) em.persist(em.create(MessageProjectionEntity, {
    id: identity("message", message.id), ...scope, remoteMessageId: message.id, position, contentJson: json(message),
  }));
  for (const [position, artifact] of artifacts.entries()) em.persist(em.create(ArtifactProjectionEntity, {
    id: identity("artifact", artifact.artifactId), ...scope, remoteArtifactId: artifact.artifactId, position, contentJson: json(artifact),
  }));
  await em.flush();
}

/** One statement sees the active pointer and all its content in a single MVCC snapshot. */
export async function readContentProjection(em: EntityManager, organizationId: string, taskId: string): Promise<JsonValue | undefined> {
  const rows = await em.getConnection().execute<{ content: JsonValue }[]>(`
    select p.header_json || jsonb_build_object(
      'messages', coalesce((select jsonb_agg(m.content_json order by m.position) from message_projections m
        where m.task_id = p.task_id and m.organization_id = p.organization_id and m.projection_version = p.projection_version), '[]'::jsonb),
      'artifacts', coalesce((select jsonb_agg(a.content_json order by a.position) from artifact_projections a
        where a.task_id = p.task_id and a.organization_id = p.organization_id and a.projection_version = p.projection_version), '[]'::jsonb)
    ) as content from task_projections p join tasks t on t.id = p.task_id and t.organization_id = p.organization_id
      and t.projection_version = p.projection_version where t.organization_id = ? and t.id = ?`,
    [organizationId, taskId], "all", em.getTransactionContext());
  return rows[0]?.content;
}
