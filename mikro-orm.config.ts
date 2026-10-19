import { createMikroOrmOptions, loadDatabaseConfig } from "./src/server/adapters/db/config";
import { claimPgliteDirectory } from "./src/server/adapters/db/pglite-guard";

// The MikroORM CLI (`npm run db:migrate`) opens the database from this file. PGlite has no lock of its own, so claim the
// folder for the life of the command; it is released when the command exits.
const config = loadDatabaseConfig();
if (config.profile === "pglite") claimPgliteDirectory(config.dataDir);

export default createMikroOrmOptions(config);
