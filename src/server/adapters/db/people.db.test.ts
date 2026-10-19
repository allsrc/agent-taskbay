import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import type { DatabaseConfig } from "./config";
import { createDatabaseOrm } from "./orm";
import { createPersistenceRepositories } from "./repositories";
import { provisionIdentity, DatabaseIdentityRepository } from "./identity-repository";
import { changeMemberRole, deactivateMember, PeopleError, provisionMember, reactivateMember } from "./people-repository";
import { MembershipEntity, SecurityAuditEntity, UserEntity, UserSessionEntity } from "./entities";
import { bootstrapDefaultLocalOrganization } from "../../application/services/bootstrap-default-organization";
import { opaqueToken, tokenHash } from "../auth/oidc";

const ISSUER = "https://idp.example.test";

async function contract(config: DatabaseConfig) {
  const orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const org = await bootstrapDefaultLocalOrganization(createPersistenceRepositories(orm.em.fork()).organizations);
    const base = { issuer: ISSUER, organizationId: org.id };
    const admin = await provisionIdentity(orm.em.fork(), { ...base, subject: "admin", displayName: "Ada", role: "admin" });
    
    const run = <T>(work: (tx: ReturnType<typeof orm.em.fork>) => Promise<T>) => orm.em.fork().transactional(work);
    const refuses = async (work: Promise<unknown>, message: RegExp) => {
      const error = await work.then(() => undefined, (cause: unknown) => cause);
      expect(error).toBeInstanceOf(PeopleError);
      expect((error as Error).message).toMatch(message);
    };

    // Adding a person provisions the identity and is audited with the actor.
    const id = await run((tx) => provisionMember(tx, admin, { issuer: ISSUER, subject: "  bo  ", displayName: " Bo ", role: "viewer" }));
    const bo = await orm.em.fork().findOneOrFail(MembershipEntity, { id });
    expect([bo.role, bo.enabled]).toEqual(["viewer", true]);
    expect((await orm.em.fork().findOneOrFail(UserEntity, { id: bo.userId })).displayName).toBe("Bo");
    await refuses(run((tx) => provisionMember(tx, admin, { issuer: ISSUER, subject: " ", displayName: "X", role: "viewer" })), /subject/);
    await refuses(run((tx) => provisionMember(tx, admin, { issuer: ISSUER, subject: "x", displayName: "X", role: "root" as never })), /role/);

    // Changing a role is audited; a no-op writes nothing; people elsewhere and unknown IDs are refused.
    await run((tx) => changeMemberRole(tx, admin, { membershipId: id, role: "operator" }));
    expect((await orm.em.fork().findOneOrFail(MembershipEntity, { id })).role).toBe("operator");
    await run((tx) => changeMemberRole(tx, admin, { membershipId: id, role: "operator" }));
    await refuses(run((tx) => changeMemberRole(tx, admin, { membershipId: randomUUID(), role: "viewer" })), /Unknown person/);
    const foreign = await createPersistenceRepositories(orm.em.fork()).organizations.getOrCreate({ id: randomUUID(), slug: "foreign", name: "Foreign", createdAt: new Date(), updatedAt: new Date() });
    const outsider = await provisionIdentity(orm.em.fork(), { issuer: ISSUER, organizationId: foreign.id, subject: "out", displayName: "Out", role: "operator" });
    await refuses(run((tx) => deactivateMember(tx, admin, outsider.membershipId)), /Unknown person/);

    // Nobody can change or deactivate themselves, so an administrator always remains.
    await refuses(run((tx) => changeMemberRole(tx, admin, { membershipId: admin.membershipId, role: "viewer" })), /yourself/);
    await refuses(run((tx) => deactivateMember(tx, admin, admin.membershipId)), /yourself/);

    // Deactivating ends their sessions at once and keeps the record; reactivating brings it back.
    const token = opaqueToken();
    await new DatabaseIdentityRepository(orm.em.fork()).createSession(tokenHash(token), { ...admin, membershipId: id, userId: bo.userId, role: "operator" }, new Date(Date.now() + 60_000));
    await run((tx) => deactivateMember(tx, admin, id));
    expect((await orm.em.fork().findOneOrFail(MembershipEntity, { id })).enabled).toBe(false);
    expect(await orm.em.fork().count(UserSessionEntity, { membershipId: id })).toBe(0);
    expect(await new DatabaseIdentityRepository(orm.em.fork()).resolveSession(tokenHash(token), new Date())).toBeUndefined();
    await run((tx) => reactivateMember(tx, admin, id));
    expect((await orm.em.fork().findOneOrFail(MembershipEntity, { id })).enabled).toBe(true);
    await orm.em.fork().nativeUpdate(UserEntity, { id: bo.userId }, { enabled: false });
    await run((tx) => deactivateMember(tx, admin, id));
    await refuses(run((tx) => reactivateMember(tx, admin, id)), /disabled on the server/);

    // Re-adding someone who was deactivated turns them back on with the new role.
    await orm.em.fork().nativeUpdate(UserEntity, { id: bo.userId }, { enabled: true });
    await run((tx) => provisionMember(tx, admin, { issuer: ISSUER, subject: "bo", displayName: "Bo", role: "viewer" }));
    const again = await orm.em.fork().findOneOrFail(MembershipEntity, { id });
    expect([again.role, again.enabled]).toEqual(["viewer", true]);

    const actions = (await orm.em.fork().find(SecurityAuditEntity, { actorType: "user" })).map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(["member.provisioned", "member.role_changed", "member.deactivated", "member.reactivated"]));
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally { await orm.close(true); }
}

async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-people-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

describe("people management (PGlite)", () => {
  it("provisions, changes roles, deactivates and reactivates with guards and audit", async () => {
    await temporary((directory) => contract({ profile: "pglite", dataDir: join(directory, "db") }));
  });
});
const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
(postgresUrl ? describe : describe.skip)("people management (PostgreSQL)", () => {
  it("passes the same contract", async () => {
    await temporary(() => contract({ profile: "postgresql", url: postgresUrl! }));
  });
});
