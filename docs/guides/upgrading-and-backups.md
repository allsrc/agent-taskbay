# Upgrading and backups

> For operators of a running Agent Taskbay. At the end you will know what to back up, how to upgrade without losing data, and how to restore.

Taskbay keeps three kinds of state that must stay consistent with each other: the database, the artifact directory, and the vault keys. Backups, upgrades and restores are all about treating those three
as one unit. Backup and restore tooling is not provided; this page tells you what to copy and what to check.

The project is pre-1.0 (0.1.0). Interfaces and migrations may change in any minor version. Read [`CHANGELOG.md`](../../CHANGELOG.md) before each upgrade.

## Before you start

- A source checkout deployment as described in [Production deployment](./production-deployment.md). The migration and rebuild commands are npm scripts in the repository.
- Database access for dumps (`pg_dump` and `pg_restore` for PostgreSQL).

## What to back up

| Item | Where | Why it matters |
|---|---|---|
| Database | PostgreSQL, or the PGlite directory (`A2A_PGLITE_DATA_DIR`, default `.data/pglite`; launcher: `pglite/` in its data directory) | Tasks, protocol event ledger, projections, audit log, grants, sessions, encrypted credentials. |
| Artifact directory | `A2A_ARTIFACT_DATA_DIR` (default `.data/artifacts`; launcher: `artifacts/`) | Binary artifacts and the archived original protocol events. A projection rebuild reads these archives; without them a task with binary content cannot be rebuilt. |
| Vault keys | `A2A_VAULT_KEYS` and `A2A_VAULT_ACTIVE_KEY` (launcher: `secrets.json`) | Without the keys the encrypted credentials in the database cannot be read. Store this backup **apart** from the database backup. |
| Other server secrets | `A2A_AUTH_FLOW_KEY`, `A2A_OIDC_CLIENT_SECRET`, `A2A_PUSH_SIGNING_KEY`, `A2A_NOTIFY_WEBHOOK_SECRET` | They live only in your environment. The flow key can be regenerated (pending logins are lost). Changing the push signing key invalidates existing push callbacks. |

Take the database dump and the artifact copy at the same time, and do not restore one without the other. The store writes artifact bytes before the database transaction commits, so a newer artifact
directory than the database is harmless (extra files are never referenced). A newer database than the artifact directory is not: the database then points at archives that are missing.

For PGlite, stop the web process before copying the directory; only one process may own it, and a copy of a live directory is not known to be consistent.

```bash
pg_dump --format=custom --file=taskbay.dump "$A2A_DATABASE_URL"
```

Then copy the artifact directory, for example with `rsync -a`, immediately after.

## Upgrade

1. Read the changelog for anything that needs manual steps.
2. Back up (above).
3. Stop the workers and the web process. This is the supported order: nothing runs against a schema it was not built for.
4. Update the code and rebuild:

   ```bash
   git pull
   ```

   ```bash
   npm ci
   ```

   ```bash
   npm run build
   ```

5. Apply migrations (see below).
6. Start web, then workers.
7. Check `curl -i https://YOUR_ORIGIN/api/auth/session` (expect 401 `Sign in to continue.`), sign in, open a task that existed before the upgrade, and send a message.

### Migrations

Migration files are applied in order and recorded in the `agent_taskbay_migrations` table.

| Command | Does |
|---|---|
| `npm run db:migration:pending` | Lists unapplied migrations. |
| `npm run db:migration:list` | Lists applied migrations. |
| `npm run db:migrate` | Applies every pending migration. |
| `npm run db:schema:check` | Fails if the database schema differs from the entity definitions (drift). Used in `npm run check`. |
| `npm run db:migrate:down` | Reverts migrations (the MikroORM `migration:down` command). |

When migrations run by themselves:

| Situation | Default |
|---|---|
| `next dev` with PGlite | On |
| `npx agent-taskbay` launcher with PGlite | On |
| Everything else, including production builds and PostgreSQL | **Off.** Run `npm run db:migrate` yourself. |
| Any situation with `A2A_AUTO_MIGRATE` set | `true` turns it on, any other non-empty value turns it off. |

With more than one web replica keep `A2A_AUTO_MIGRATE` off and run `db:migrate` once per release. Replicas racing to migrate is the case the default avoids.

The migrations add append-only triggers on the security audit table and on the fixed core of approval requests. Updates and deletes on those rows fail with `audit records are append-only` or
`decision request core is immutable`. Do not try to clean them up; take them into account when you write data fixes.

Treat `db:migrate:down` as a developer tool. It is not a substitute for restoring a backup: whether every migration can be reverted without losing data is not verified, and projection data may need
rebuilding afterwards.

## Rebuild projections

The task views Taskbay shows are projections of an append-only event ledger. A rebuild recomputes them from the retained events and original artifact archives. It does not send messages to agents and does
not modify the ledger. You need it when:

- you upgrade across a version whose notes say so (older tasks stay readable but may use an older projection until they are observed again or rebuilt), or
- tasks with binary artifacts predate artifact permission records. A rebuild creates the server-side references that authorize downloads.

Apply migrations first, then:

```bash
npm run db:projections:rebuild
```

| Option | Meaning |
|---|---|
| `--organization UUID` | Organization to rebuild. Without it the script uses the organization with slug `local`, and stops with `No local organization; specify --organization UUID.` if there is none, which is the case for any deployment that provisioned another slug. |
| `--task UUID` | Rebuild a single task. |
| `--offline-pglite` | Required with PGlite, after stopping the web process. |

With PostgreSQL the web process can stay up and keeps serving the last readable projection. It prints one line per task, `Rebuilt task <id> with projector 2.`, and ends with
`Rebuilt <n> task projections. Re-running safely resumes by task.` Interrupted runs can simply be repeated.

Use the same database and artifact settings as the web and worker. If the environment differs, the rebuild looks at the wrong data.

### Rebuild failures

A failed task keeps its previous projection. The script stops at the first error.

| Message | Cause |
|---|---|
| `Apply pending database migrations before rebuilding.` | Run `npm run db:migrate`. |
| `Stop the PGlite web process, then pass --offline-pglite; a running owner must use the runtime rebuild service.` | PGlite, flag missing. |
| `Usage: db:projections:rebuild -- [--offline-pglite] [--organization UUID] [--task UUID]` | An unknown argument. |
| `--organization requires a local UUID.` / `--task requires a local UUID.` | The value is not a UUID. Use the local ID, not a remote task ID. |
| `Unknown task in organization.` | The `--task` UUID is not in that organization. |
| `Protocol archive missing or corrupt.` | An archive file is absent or unreadable. Restore the artifact directory from backup. |
| `Protocol archive event digest mismatch.` | An archive file was altered or damaged. Restore it from backup. |
| `Cannot rebuild a task without retained protocol events.` | The task has no ledger events to rebuild from. |
| `Task changed during rebuild; retry later.` | The task was updated while it was rebuilt. Run it again. |

## Restore

1. Stop web and workers.
2. Restore the database into an empty database from the dump:

   ```bash
   pg_restore --dbname="$A2A_DATABASE_URL" --no-owner taskbay.dump
   ```

3. Restore the artifact directory from the copy made at the same time or later.
4. Restore the vault keys into `A2A_VAULT_KEYS` and `A2A_VAULT_ACTIVE_KEY`, plus your other server secrets.
5. Run `npm run db:migration:pending`. It should list nothing if the dump came from the same version; if you restore into a newer code version, run `npm run db:migrate`.
6. Start web, then workers. Workers pick up unfinished work after leases expire (15 seconds for streams, 60 seconds for command dispatch).
7. Run the checks from the upgrade steps, and open a task that has an artifact to confirm the download works.

Practice this on a copy before you need it. Whether a restored deployment resumes cleanly after losing a worker or host has not been tested by the project.

After a restore, a command that was dispatched but whose outcome is not recorded is shown as needing investigation. Taskbay never resends it on its own, because the agent may have processed it.

## Moving between database profiles

There is no tool to move data from PGlite to PostgreSQL, or back. Start production on PostgreSQL. If you need to keep a PGlite demo's data, that is not supported by anything in this repository.

## When it fails

| Symptom | Cause | Fix |
|---|---|---|
| Server errors on every request right after upgrading | Pending migrations | `npm run db:migrate` |
| `npm run db:schema:check` fails | Schema drift: the database does not match the code | Check which migrations are pending; do not edit the schema by hand |
| Credentials fail with `Credential vault unavailable.` after restore | Wrong or missing vault key | Restore the key ring that was active when the binding was stored |
| Artifact downloads fail or a rebuild reports `Protocol archive missing or corrupt.` | Artifact directory older than the database, or lost | Restore a newer artifact copy |
| Push callbacks answer 401 after restore | Different `A2A_PUSH_SIGNING_KEY` | Restore the original key, or follow the rotation steps in [Troubleshooting](../operations/troubleshooting.md) |

## Limits

- No scripted backup, restore or retention. No online consistent snapshot across database and artifacts.
- Artifacts are never deleted by Taskbay; the directory grows with use.
- No version-to-version upgrade notes exist yet beyond the changelog, because 0.1.0 is the only version and it has not been published.

## Related

- [Production deployment](./production-deployment.md)
- [Running and workers](../operations/running-and-workers.md)
- [Troubleshooting](../operations/troubleshooting.md)
- [Durable tasks](../concepts/durable-tasks.md)
