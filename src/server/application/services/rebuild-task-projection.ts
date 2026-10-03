import type { ArtifactStore } from "../ports/artifact-store";
import type { ProjectionRebuildRepository } from "../ports/projection-rebuild";
import { restoreArchivedEvent } from "./protocol-archive";
import { reduceTaskLedger } from "./versioned-task-projection";

export class RebuildTaskProjectionService {
  constructor(private readonly repository: ProjectionRebuildRepository, private readonly store: ArtifactStore) {}

  async rebuild(organizationId: string, taskId: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await this.repository.capture(organizationId, taskId);
      if (!snapshot) throw new Error("Unknown task in organization.");
      if (!snapshot.events.length) throw new Error("Cannot rebuild a task without retained protocol events.");
      const restored = [];
      const binaryDigests = new Set<string>();
      // Bound object-store IO and memory; fail before touching the active generation.
      for (const row of snapshot.events) restored.push(await restoreArchivedEvent(row, this.store, async (digests) => {for (const digest of digests) binaryDigests.add(digest);}));
      const view = reduceTaskLedger(snapshot.task, snapshot.agentName, restored);
      if (await this.repository.activate(snapshot, view, [...binaryDigests])) return view;
    }
    throw new Error("Task changed during rebuild; retry later.");
  }
}
