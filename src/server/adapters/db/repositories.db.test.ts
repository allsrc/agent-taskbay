import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { UniqueConstraintViolationException } from "@mikro-orm/core";
import { describe, expect, it } from "vitest";

import { bootstrapDefaultLocalOrganization } from "../../application/services/bootstrap-default-organization";
import type {
  AgentRecord,
  OutboxMessageRecord,
  TaskEventRecord,
  TaskRecord,
} from "../../domain/persistence-model";
import type { DatabaseConfig } from "./config";
import { bootstrapRuntimeDatabase, createDatabaseOrm } from "./orm";
import { createPersistenceRepositories } from "./repositories";

const fixedNow = new Date("2026-10-01T00:00:00.000Z");

function agent(
  organizationId: string,
  overrides: Partial<AgentRecord> = {},
): AgentRecord {
  return {
    id: randomUUID(),
    organizationId,
    cardUrl: `https://agent-${randomUUID()}.example.test/.well-known/agent-card.json`,
    source: "managed",
    enabled: true,
    displayName: "Test agent",
    description: null,
    protocolSnapshotVersion: null,
    lastDiscoveryAt: null,
    lastHealthyAt: null,
    createdAt: fixedNow,
    updatedAt: fixedNow,
    ...overrides,
  };
}

function task(
  organizationId: string,
  agentId: string,
  overrides: Partial<TaskRecord> = {},
): TaskRecord {
  return {
    id: randomUUID(),
    organizationId,
    agentId,
    tenant: "",
    remoteTaskId: `remote-${randomUUID()}`,
    remoteContextId: null,
    kind: "task",
    state: "submitted",
    title: null,
    ownerUserId: null,
    ownerTeamId: null,
    createdAt: fixedNow,
    remoteCreatedAt: null,
    updatedAt: fixedNow,
    remoteUpdatedAt: null,
    terminalAt: null,
    version: 1,
    contentJson: {},
    ...overrides,
  };
}

function taskEvent(
  organizationId: string,
  agentId: string,
  taskId: string,
  overrides: Partial<TaskEventRecord> = {},
): TaskEventRecord {
  return {
    id: randomUUID(),
    organizationId,
    agentId,
    taskId,
    source: "stream",
    eventKind: "status-update",
    receivedAt: fixedNow,
    remoteTimestamp: null,
    sourceKey: `event-${randomUUID()}`,
    payloadDigest: "a".repeat(64),
    payloadJson: { state: "working" },
    sessionId: null,
    requestId: null,
    traceId: null,
    projectionVersion: 1,
    ...overrides,
  };
}

async function verifyRepositoryContract(config: DatabaseConfig) {
  const orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length > 0) {
      await orm.migrator.down({ to: 0 });
    }
    await orm.migrator.up();

    const entityManager = orm.em.fork({ clear: true, useContext: false });
    const repositories = createPersistenceRepositories(entityManager);

    const organizationId = randomUUID();
    const organization = await bootstrapDefaultLocalOrganization(
      repositories.organizations,
      { now: () => fixedNow },
      () => organizationId,
    );
    const repeatedBootstrap = await bootstrapDefaultLocalOrganization(
      repositories.organizations,
      { now: () => new Date("2026-10-02T00:00:00.000Z") },
      randomUUID,
    );
    expect(repeatedBootstrap).toEqual(organization);
    expect(await bootstrapRuntimeDatabase(orm)).toEqual(organization);

    const otherOrganization = await repositories.organizations.getOrCreate({
      id: randomUUID(),
      slug: "other",
      name: "Other",
      createdAt: fixedNow,
      updatedAt: fixedNow,
    });

    const firstAgent = await repositories.agents.insert(
      agent(organization.id, {
        cardUrl: "https://one.example.test/.well-known/agent-card.json",
      }),
    );
    const secondAgent = await repositories.agents.insert(agent(organization.id));
    const otherOrganizationAgent = await repositories.agents.insert(
      agent(otherOrganization.id, { cardUrl: firstAgent.cardUrl }),
    );
    expect(otherOrganizationAgent.organizationId).toBe(otherOrganization.id);
    expect(
      await repositories.agents.findById(otherOrganization.id, firstAgent.id),
    ).toBeUndefined();

    const duplicateEntityManager = orm.em.fork({
      clear: true,
      useContext: false,
    });
    await expect(
      createPersistenceRepositories(duplicateEntityManager).agents.insert(
        agent(organization.id, { cardUrl: firstAgent.cardUrl }),
      ),
    ).rejects.toBeInstanceOf(UniqueConstraintViolationException);
    duplicateEntityManager.clear();

    await repositories.agents.appendCardSnapshot({
      id: randomUUID(),
      agentId: firstAgent.id,
      fetchedAt: fixedNow,
      resolvedCardUrl: firstAgent.cardUrl,
      rawCardJson: { name: "old" },
      normalizedCardJson: { name: "old" },
      complianceJson: { score: 90 },
      signatureStatus: "unknown",
      digest: "b".repeat(64),
    });
    const latestSnapshot = await repositories.agents.appendCardSnapshot({
      id: randomUUID(),
      agentId: firstAgent.id,
      fetchedAt: new Date("2026-10-01T01:00:00.000Z"),
      resolvedCardUrl: firstAgent.cardUrl,
      rawCardJson: { name: "new" },
      normalizedCardJson: { name: "new" },
      complianceJson: { score: 100 },
      signatureStatus: "verified",
      digest: "c".repeat(64),
    });
    expect(
      await repositories.agents.findLatestCardSnapshot(firstAgent.id),
    ).toEqual(latestSnapshot);

    const remoteTaskId = `shared-${randomUUID()}`;
    const firstTask = await repositories.tasks.insert(
      task(organization.id, firstAgent.id, { remoteTaskId }),
    );
    const otherTenantTask = await repositories.tasks.insert(
      task(organization.id, firstAgent.id, {
        tenant: "tenant-b",
        remoteTaskId,
      }),
    );
    const otherAgentTask = await repositories.tasks.insert(
      task(organization.id, secondAgent.id, { remoteTaskId }),
    );
    expect(otherTenantTask.id).not.toBe(firstTask.id);
    expect(otherAgentTask.id).not.toBe(firstTask.id);
    expect(
      await repositories.tasks.findByRemoteIdentity({
        organizationId: organization.id,
        agentId: firstAgent.id,
        tenant: "",
        remoteTaskId,
      }),
    ).toEqual(firstTask);

    const duplicateTaskEntityManager = orm.em.fork({
      clear: true,
      useContext: false,
    });
    await expect(
      createPersistenceRepositories(duplicateTaskEntityManager).tasks.insert(
        task(organization.id, firstAgent.id, { remoteTaskId }),
      ),
    ).rejects.toBeInstanceOf(UniqueConstraintViolationException);
    duplicateTaskEntityManager.clear();

    await repositories.tasks.insert(
      task(organization.id, firstAgent.id, { remoteTaskId: null }),
    );
    await repositories.tasks.insert(
      task(organization.id, firstAgent.id, { remoteTaskId: null }),
    );

    const firstEvent = taskEvent(
      organization.id,
      firstAgent.id,
      firstTask.id,
      { sourceKey: "stable-event-key" },
    );
    expect(await repositories.taskEvents.appendIfAbsent(firstEvent)).toBe(true);
    expect(
      await repositories.taskEvents.appendIfAbsent({
        ...firstEvent,
        id: randomUUID(),
      }),
    ).toBe(false);
    expect(
      await repositories.taskEvents.findByTaskId(
        organization.id,
        firstTask.id,
      ),
    ).toEqual([{ ...firstEvent, sequence: expect.any(Number) }]);
    expect(
      await repositories.taskEvents.findByTaskId(
        otherOrganization.id,
        firstTask.id,
      ),
    ).toEqual([]);

    const outboxMessage: OutboxMessageRecord = {
      id: randomUUID(),
      organizationId: organization.id,
      topic: "task.updated",
      aggregateType: "task",
      aggregateId: firstTask.id,
      payloadJson: { taskId: firstTask.id },
      availableAt: fixedNow,
      attempts: 0,
      status: "pending",
      leaseOwner: null,
      leaseUntil: null,
      lastError: null,
      createdAt: fixedNow,
      processedAt: null,
    };
    await repositories.outbox.enqueue(outboxMessage);
    expect(
      await repositories.outbox.findById(organization.id, outboxMessage.id),
    ).toEqual(outboxMessage);
    expect(
      await repositories.outbox.findById(otherOrganization.id, outboxMessage.id),
    ).toBeUndefined();
  } finally {
    await orm.close(true);
  }
}

describe("PGlite repository contract", () => {
  it("persists the initial model and enforces tenant-scoped identities", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "agent-taskbay-repositories-"));
    try {
      await verifyRepositoryContract({ profile: "pglite", dataDir });
    } finally {
      await rm(dataDir, { force: true, recursive: true });
    }
  });
});

const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
if (process.env.CI === "true" && !postgresUrl) {
  throw new Error("CI must set A2A_TEST_POSTGRES_URL for the PostgreSQL contract");
}
if (postgresUrl && !decodeURIComponent(new URL(postgresUrl).pathname).includes("test")) {
  throw new Error("A2A_TEST_POSTGRES_URL must target a database containing 'test' in its name");
}

const describePostgreSql = postgresUrl ? describe : describe.skip;
describePostgreSql("PostgreSQL repository contract", () => {
  it("matches the PGlite repository behavior", async () => {
    await verifyRepositoryContract({
      profile: "postgresql",
      url: postgresUrl!,
    });
  });
});
