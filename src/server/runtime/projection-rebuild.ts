import { IsolationLevel, LockMode, type MikroORM } from "@mikro-orm/core";
import type { ArtifactStore } from "../application/ports/artifact-store";
import type { ProjectionRebuildRepository } from "../application/ports/projection-rebuild";
import type { JsonValue } from "../domain/persistence-model";
import { RebuildTaskProjectionService } from "../application/services/rebuild-task-projection";
import { TASK_PROJECTOR_VERSION } from "../application/services/versioned-task-projection";
import { createPersistenceRepositories } from "../adapters/db/repositories";
import { TaskEntity } from "../adapters/db/entities";
import { withJobEntityManager } from "../adapters/db/orm";
import { artifactStore } from "./task-persistence";

export function createProjectionRebuilder(options: { orm?: MikroORM; store?: ArtifactStore } = {}) {
  const repository: ProjectionRebuildRepository = {
    capture: (organizationId, taskId) => withJobEntityManager((em) => em.transactional(async (tx) => {
      const ports = createPersistenceRepositories(tx);
      const task = await ports.tasks.findById(organizationId, taskId, false);
      if (!task) return undefined;
      const agent = await ports.agents.findById(organizationId, task.agentId);
      return { task, agentName: agent?.displayName ?? "Agent", events: await ports.taskEvents.findByTaskId(organizationId, taskId) };
    }, { isolationLevel: IsolationLevel.REPEATABLE_READ }), options.orm),
    activate: (snapshot, view) => withJobEntityManager((em) => em.transactional(async (tx) => {
      // Lock without attempting to repair or insert an unknown identity.
      const current = await tx.findOne(TaskEntity, { id: snapshot.task.id, organizationId: snapshot.task.organizationId },
        { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
      if (!current || current.version !== snapshot.task.version) return false;
      const remoteUpdatedAt = snapshot.events.reduce<Date | null>((latest, row) => row.remoteTimestamp && (!latest || row.remoteTimestamp > latest) ? row.remoteTimestamp : latest, null);
      const terminal = ["COMPLETED", "FAILED", "CANCELED", "REJECTED"].includes(view.state.replace("TASK_STATE_", ""));
      await createPersistenceRepositories(tx).tasks.saveProjection({ ...snapshot.task,
        projectionVersion: TASK_PROJECTOR_VERSION, contentJson: view as unknown as JsonValue,
        state: view.state, title: view.title ?? null, remoteContextId: view.contextId ?? null,
        updatedAt: new Date(view.updatedAt), remoteUpdatedAt,
        terminalAt: terminal ? snapshot.task.terminalAt ?? new Date(view.updatedAt) : null,
      });
      return true;
    }), options.orm),
  };
  return new RebuildTaskProjectionService(repository, options.store ?? artifactStore);
}
