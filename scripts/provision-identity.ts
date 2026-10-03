import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { createDatabaseOrm } from "../src/server/adapters/db/orm";
import { createPersistenceRepositories } from "../src/server/adapters/db/repositories";
import { provisionIdentity } from "../src/server/adapters/db/identity-repository";
import { loadDatabaseConfig } from "../src/server/adapters/db/config";
import type { OrganizationRole } from "../src/server/application/ports/identity";

const { values } = parseArgs({ options: { issuer: { type: "string" }, subject: { type: "string" },
  organization: { type: "string" }, name: { type: "string" }, role: { type: "string" }, "offline-pglite": { type: "boolean" } } });
if (!values.issuer || !values.subject || !values.organization || !values.name || !["admin", "operator", "viewer"].includes(values.role ?? "")) {
  throw new Error("Usage: auth:provision --issuer HTTPS_ISSUER --subject EXACT_SUBJECT --organization SLUG --name NAME --role admin|operator|viewer [--offline-pglite]");
}
const issuer = new URL(values.issuer);
if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash) throw new Error("An HTTPS issuer without credentials is required.");
if (loadDatabaseConfig().profile === "pglite" && !values["offline-pglite"]) throw new Error("Stop web first and explicitly use --offline-pglite for single-owner PGlite.");
const orm = await createDatabaseOrm();
try {
  await orm.em.fork().transactional(async (tx) => {
    const now = new Date();
    const org = await createPersistenceRepositories(tx).organizations.getOrCreate({ id: randomUUID(), slug: values.organization!,
      name: values.organization!, createdAt: now, updatedAt: now });
    await provisionIdentity(tx, { issuer: issuer.href.replace(/\/$/, ""), subject: values.subject!, organizationId: org.id,
      displayName: values.name!, role: values.role as OrganizationRole });
  });
  console.log("Identity membership provisioned.");
} finally { await orm.close(true); }
