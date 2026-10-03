import nextEnvironment from "@next/env";
nextEnvironment.loadEnvConfig(process.cwd());
import { parseArgs } from "node:util";
import { createDatabaseOrm } from "../src/server/adapters/db/orm";
import { loadDatabaseConfig } from "../src/server/adapters/db/config";
import { createPersistenceRepositories } from "../src/server/adapters/db/repositories";
import { EncryptedDatabaseCredentialVault } from "../src/server/adapters/db/credential-vault";
import { credentialBindingSchema } from "../src/server/adapters/auth/credential-schema";

const {values} = parseArgs({options: {organization: {type: "string"}, agent: {type: "string"},
  action: {type: "string", default: "store"}, "offline-pglite": {type: "boolean"}}});
async function manage() {
  if (!values.organization || !values.agent || !["store", "revoke", "reencrypt"].includes(values.action ?? "")) throw new Error();
  if (loadDatabaseConfig().profile === "pglite" && !values["offline-pglite"]) {
    console.error("Stop the local web server and pass --offline-pglite before opening its PGlite directory."); process.exitCode = 1; return;
  }
  const orm = await createDatabaseOrm();
  try {
    if ((await orm.migrator.getPending()).length) throw new Error();
    const em = orm.em.fork();
    const org = await createPersistenceRepositories(em).organizations.findBySlug(values.organization!);
    if (!org) throw new Error();
    const vault = new EncryptedDatabaseCredentialVault(em);
    if (values.action === "revoke") await vault.revoke(org.id, values.agent!);
    else if (values.action === "reencrypt") {
      const binding = await vault.resolve(org.id, values.agent!);
      if (!binding) throw new Error();
      await vault.store(org.id, values.agent!, binding);
    } else {
      let input = "";
      for await (const chunk of process.stdin) {
        input += chunk; if (Buffer.byteLength(input) > 256_000) throw new Error();
      }
      await vault.store(org.id, values.agent!, credentialBindingSchema.parse(JSON.parse(input)));
    }
    console.log("Agent credential binding updated.");
  } finally { await orm.close(true); }
}
await manage().catch(() => { console.error("Credential update failed. Check the organization/agent, vault key configuration and stdin binding format. No secret values are printed."); process.exitCode = 1; });
