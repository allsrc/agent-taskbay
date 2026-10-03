import nextEnvironment from "@next/env";
nextEnvironment.loadEnvConfig(process.cwd());
const { loadDatabaseConfig } = await import("../src/server/adapters/db/config");
const config = loadDatabaseConfig();
const args = process.argv.slice(2);
if (args.some((arg) => !["--offline-pglite", "--organization", "--task"].includes(arg) && !/^[a-f0-9-]{36}$/i.test(arg))) throw new Error("Usage: db:projections:rebuild -- [--offline-pglite] [--organization UUID] [--task UUID]");
if (config.profile === "pglite" && !args.includes("--offline-pglite")) throw new Error("Stop the PGlite web process, then pass --offline-pglite; a running owner must use the runtime rebuild service.");
const parameter = (name: string) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value ?? "")) throw new Error(`${name} requires a local UUID.`);
  return value;
};
const organizationArg = parameter("--organization");
const taskArg = parameter("--task");
const { createDatabaseOrm } = await import("../src/server/adapters/db/orm");
const { createPersistenceRepositories } = await import("../src/server/adapters/db/repositories");
const { TaskEntity } = await import("../src/server/adapters/db/entities");
const { createProjectionRebuilder } = await import("../src/server/runtime/projection-rebuild");
const orm = await createDatabaseOrm(config);
try {
  if ((await orm.migrator.getPending()).length) throw new Error("Apply pending database migrations before rebuilding.");
  const repositories = createPersistenceRepositories(orm.em.fork());
  const organizationId = organizationArg ?? (await repositories.organizations.findBySlug("local"))?.id;
  if (!organizationId) throw new Error("No local organization; specify --organization UUID.");
  const rebuilder = createProjectionRebuilder({ orm });
  let after: string | undefined;
  let completed = 0;
  do {
    const tasks = await orm.em.fork().find(TaskEntity, { organizationId, ...(taskArg ? { id: taskArg } : after ? { id: { $gt: after } } : {}) },
      { fields: ["id"], orderBy: { id: "asc" }, limit: 100 });
    if (taskArg && !tasks.length) throw new Error("Unknown task in organization.");
    if (!tasks.length) break;
    for (const task of tasks) {
      await rebuilder.rebuild(organizationId, task.id);
      completed++;
      console.log(`Rebuilt task ${task.id} with projector 2.`);
    }
    after = tasks.at(-1)!.id;
    if (taskArg) break;
  } while (true);
  console.log(`Rebuilt ${completed} task projections. Re-running safely resumes by task.`);
} finally { await orm.close(true); }
