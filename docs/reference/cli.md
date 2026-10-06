# CLI reference

> For anyone who needs the exact commands, flags and exit behavior: the `agent-taskbay` launcher, every `npm run` script, and the operational
> scripts under `scripts/`.

Agent Taskbay is pre-1.0 (package version `0.1.0`) and, at the time of writing, is not yet published to npm. In a git checkout run the launcher as
`node bin/agent-taskbay.mjs` after `npm run build`; the `npx agent-taskbay` form below applies once a version is published. Flags and
script names may change between minor versions.

Requirements: Node.js 22.19.0 or newer (see [Compatibility](compatibility.md#runtime-versions)).

## `agent-taskbay`

The launcher starts the production server with an embedded database, a generated credential-vault key and a development administrator, bound to
loopback. It exists so you can try the console with one command. It is not a production deployment tool.

```bash
npx agent-taskbay
```

### Synopsis

```text
agent-taskbay [start] [options]     Start the console (default command)
agent-taskbay demo-agent [port]     Serve sample A2A agents to connect to the console
agent-taskbay --version | --help
```

### Options for `start`

| Option | Default | Effect |
| --- | --- | --- |
| `-p`, `--port <number>`, `--port=<number>` | `$PORT`, else `3002` | Port to listen on. Must be an integer from 1 to 65535, otherwise `agent-taskbay: "<value>" is not a valid port.` |
| `-H`, `--host <address>`, `--host=<address>` | `127.0.0.1` | Address to bind. Without OIDC configured only loopback addresses are accepted (`127.x.x.x`, `localhost`, `::1`). |
| `--data-dir <path>`, `--data-dir=<path>` | `$A2A_DATA_DIR`, else `~/.agent-taskbay` | Directory for the embedded database (`pglite/`), artifacts (`artifacts/`), `secrets.json` and `agent-taskbay.pid`. Created if missing. |
| `--no-open` | | Do not open a browser tab. |
| `--open` | | Open a browser tab even when not attached to a terminal. |
| `-h`, `--help` | | Print usage and exit 0. |
| `-v`, `--version` | | Print the package version (currently `0.1.0`) and exit 0. |

By default a browser tab opens when standard output is a terminal and the `CI` variable is not set.

Every `A2A_*` variable in [Configuration](configuration.md) may be supplied through the environment; values you set win over the launcher's
defaults (listed [here](configuration.md#launcher-defaults)). Setting `A2A_AUTH_MODE=oidc` or `A2A_OIDC_ISSUER` turns off local mode, and
then non-loopback hosts are allowed.

### What it does

1. Refuses to start if the package has no production build (`.next/BUILD_ID`). The published package ships one; in a checkout run `npm run build`.
2. Creates the data directory (mode 0700) and, on first run, `secrets.json` (mode 0600) holding a random vault key. If the file exists but is invalid
   it stops instead of replacing it, because replacing the key would make stored agent credentials unreadable.
3. Writes `<data-dir>/agent-taskbay.pid`. A second launch on the same directory fails while the first process is alive.
4. Runs `next start` on the chosen port and host and waits up to 120 seconds for `GET /api/auth/session` to answer with a status below 500.
5. Prints the URL and data directory, then optionally opens the browser. If the server is not ready within 120 seconds the launcher prints no
   banner but keeps waiting on the server process.

Press Ctrl+C (SIGINT) or send SIGTERM to stop. The launcher forwards the signal, removes the pid file and exits with the server's exit code.

### Exit behavior

| Situation | Message (stderr, prefixed `agent-taskbay: `) | Exit code |
| --- | --- | --- |
| Unknown flag | `Unknown option --x.` | 1 |
| Flag missing its value | `--port needs a value.` | 1 |
| Extra positional argument | `Unexpected argument x.` | 1 |
| Non-loopback host in local mode | `Local mode signs everyone in as an administrator, so it cannot listen on <host>. Use 127.0.0.1, or configure OIDC ...` | 1 |
| No production build | `There is no production build. In a git checkout run \`npm run build\` first; ...` | 1 |
| Already running | `Agent Taskbay is already running for <dir> (pid N, <url>). Stop it first or use --data-dir.` | 1 |
| `secrets.json` invalid | `<file> is not valid. Fix or remove it. Removing it makes stored agent credentials unreadable.` | 1 |
| Server exits | None. The launcher exits with the server's exit code. | as server |

A stale pid file whose process is gone is ignored and overwritten.

### `agent-taskbay demo-agent [port]`

Starts the repository's sample A2A agents (`scripts/fixture-form-agent.mjs`) on `127.0.0.1`, default port `4010`, and prints one Agent Card URL
per variant:

| Variant | Card URL | What it demonstrates |
| --- | --- | --- |
| `showcase` | `http://127.0.0.1:<port>/showcase/card.json` | Structured form, an A2UI surface and an approval request |
| `form` | `http://127.0.0.1:<port>/form/card.json` | A structured input form |
| `approver` | `http://127.0.0.1:<port>/approver/card.json` | An approval request |
| `a2ui` | `http://127.0.0.1:<port>/a2ui/card.json` | An A2UI confirmation surface |

The script also serves other variants used by tests (`plain`, `invalid`, `unknown`, `rogue`) that are not printed. These agents are test fixtures,
not examples of production agents. Stop with Ctrl+C (exit 0). The console must be allowed to reach loopback addresses, which local mode does by default.

## npm scripts

Run from the repository root. Pass extra arguments after `--`.

| Script | Runs | Notes |
| --- | --- | --- |
| `npm run dev` | `next dev -p 3002` | Development server with Turbopack, development identity and automatic migration on PGlite. |
| `npm run build` | `next build --webpack` | Production build. Production builds use webpack so the build can be shipped through npm. |
| `npm run start` | `next start -p 3002` | Serves the production build. Needs production configuration (see [Configuration](configuration.md)). |
| `npm run lint` | `eslint` | |
| `npm test` | `vitest run`, excluding `*.db.test.ts` | Unit and component tests. No database needed. |
| `npm run test:db` | Vitest over the database test files, one worker, 30 s timeout | Runs against PGlite. When `A2A_TEST_POSTGRES_URL` is set the PostgreSQL contract also runs; the URL's database name must contain `test`. If the `CI` variable is set the URL is required. |
| `npm run test:http` | The `scripts/verify-*-http.mjs` chain | Starts real production servers against the build, so run `npm run build` first. Stops at the first failing script. |
| `npm run test:coverage` | `vitest run --coverage`, excluding database tests | |
| `npm run db:migrate` | `mikro-orm migration:up` | Applies pending migrations to the configured database. |
| `npm run db:migrate:down` | `mikro-orm migration:down` | Reverts the last migration. |
| `npm run db:migration:create` | `mikro-orm migration:create` | For contributors; writes a new file in `src/server/adapters/db/migrations/`. |
| `npm run db:migration:list` | `mikro-orm migration:list` | Applied migrations. |
| `npm run db:migration:pending` | `mikro-orm migration:pending` | Migrations not yet applied. |
| `npm run db:schema:check` | `mikro-orm migration:check` | Fails if the entities and the migrations disagree. |
| `npm run check` | lint, `test`, `test:db`, `db:migrate`, `db:schema:check`, `build`, `test:http`, in that order | The full pre-merge gate; the same command CI runs. |
| `npm run worker:tasks` | `tsx scripts/command-worker.ts` | The separate background worker. [Details](#npm-run-workertasks). |
| `npm run worker:commands` | Same script as `worker:tasks` | Older name for the same command. |
| `npm run db:projections:rebuild` | `tsx scripts/rebuild-projections.ts` | [Details](#npm-run-dbprojectionsrebuild). |
| `npm run auth:provision` | `tsx scripts/provision-identity.ts` | [Details](#npm-run-authprovision). |
| `npm run security:credentials` | `tsx scripts/manage-credentials.ts` | [Details](#npm-run-securitycredentials). |
| `npm run verify:package` | `node scripts/verify-package.mjs` | Packs the project, installs the tarball into an empty directory, launches it and drives the HTTP API. Needs network access to install dependencies. Set `A2A_PACKAGE_TARBALL` to reuse an existing tarball. Also run by CI. |
| `npm run prepack` | `npm run build` | Runs automatically before `npm pack` and `npm publish`. |

The `db:*` scripts read the database settings from the shell environment (`A2A_DATABASE_PROFILE`, `A2A_DATABASE_URL`, `A2A_PGLITE_DATA_DIR`) and do not
load `.env` files.

## `npm run worker:tasks`

Runs the background loops (command dispatch, task subscriptions, push, reconciliation, freshness, decision/escalation sweep, notifications) in a
process of their own. Use it with `A2A_COMMAND_WORKER_MODE=external` on the web processes.

```bash
npm run worker:tasks
```

| Aspect | Behavior |
| --- | --- |
| Requires | `A2A_DATABASE_PROFILE=postgresql` (and `A2A_DATABASE_URL`). With PGlite it throws `The separate worker requires PostgreSQL; PGlite uses embedded dispatch.` |
| Environment | Loads `.env*` files, then reads the same variables as the web server. Push and notification settings must match the web process. |
| Migrations | Does not apply them. Run `npm run db:migrate` first. |
| Stop | SIGINT or SIGTERM: stops the loops and closes the database. The handlers are registered once, so send a second signal only if you want the default signal behavior. |
| Output | Logs only on trouble, for example `Push worker could not access durable state; will retry.` |

## `npm run db:projections:rebuild`

Rebuilds the stored task projections from the event ledger, one task at a time. Safe to re-run; it resumes by task.

```bash
npm run db:projections:rebuild -- --offline-pglite
```

| Flag | Meaning |
| --- | --- |
| `--offline-pglite` | Required when the profile is PGlite, because only one process may open the database. Stop the web server first. Not needed with PostgreSQL. |
| `--organization <uuid>` | Organization to rebuild. Default: the organization with slug `local`. |
| `--task <uuid>` | Rebuild only this local task ID. |

Output is one line per task, `Rebuilt task <id> with projector 2.`, and a final `Rebuilt N task projections. Re-running safely resumes by task.`
Failure throws and exits non-zero. Messages you may see: `Stop the PGlite web process, then pass --offline-pglite; ...`,
`Apply pending database migrations before rebuilding.`, `No local organization; specify --organization UUID.`, `Unknown task in organization.`
Any other argument that is not one of the flags above or a UUID is a usage error.

## `npm run auth:provision`

Creates or updates the person-to-organization mapping that OIDC sign-in needs. Identities are matched by exact issuer and subject; e-mail and
provider claims are never used.

```bash
npm run auth:provision -- --issuer https://idp.example.com --subject 00u1abcd --organization acme --name "Ada Lovelace" --role admin
```

| Flag | Required | Meaning |
| --- | --- | --- |
| `--issuer <url>` | yes | The provider's issuer, an `https://` URL without credentials, query or fragment. Must equal `A2A_OIDC_ISSUER` (trailing slash is normalized). |
| `--subject <value>` | yes | The exact `sub` claim of the person. |
| `--organization <slug>` | yes | Organization slug; created if it does not exist. Must equal `A2A_AUTH_ORGANIZATION_SLUG`. |
| `--name <text>` | yes | Display name. |
| `--role <role>` | yes | `admin`, `operator` or `viewer`. See [HTTP API](http-api.md#authentication-and-roles) for what each can do. |
| `--offline-pglite` | with PGlite | Acknowledges that the web server is stopped. Without it the script refuses on PGlite. |

On success it prints `Identity membership provisioned.` On bad or missing flags it throws the usage line and exits non-zero. The script reads
`A2A_DATABASE_*` from the shell and does not check for pending migrations, so apply migrations first.

## `npm run security:credentials`

Stores, revokes or re-encrypts the credential Agent Taskbay uses to call one agent. Secrets are read from standard input and are never printed.

```bash
npm run security:credentials -- --organization acme --agent 3f0c8f0e-0000-4000-8000-000000000000 --action store < binding.json
```

| Flag | Meaning |
| --- | --- |
| `--organization <slug>` | Required. Organization slug. |
| `--agent <uuid>` | Required. Local agent ID (shown in the catalog and returned by `GET /api/agents`). The agent must exist and be enabled. |
| `--action <store\|revoke\|reencrypt>` | Default `store`. `store` reads a binding from stdin (at most 256,000 bytes); `revoke` disables the binding; `reencrypt` decrypts and stores it again with the active key. |
| `--offline-pglite` | Required with PGlite; stop the web server first. |

The `store` binding is JSON of this shape (one of four credential types):

```json
{
  "origins": ["https://agents.example.com"],
  "credential": { "type": "bearer", "token": "REPLACE_WITH_TOKEN" }
}
```

`origins` holds 1 to 20 exact HTTPS origins the credential may be sent to. `credential.type` is `bearer` (`token`), `apiKey` (`name` header, `value`),
`oauthClient` (`issuer`, `tokenEndpoint`, `clientId`, `clientSecret`, optional `scope`; client-credentials grant) or `mtls` (`cert`, `key`, optional
`ca`). Secrets must be 8 to 100,000 characters. Details: [Agent credentials](../guides/agent-credentials.md).

Every failure prints the same line, `Credential update failed. Check the organization/agent, vault key configuration and stdin binding format. No secret values are printed.`,
and exits 1, so check the usual causes in that order: pending migrations, unknown organization or agent, vault variables, JSON shape. Success prints
`Agent credential binding updated.`

## Fixture agent script

`node scripts/fixture-form-agent.mjs [port]` starts the same sample agents as `demo-agent` (default port `4010`) and prints the `form`, `plain` and
`invalid` card URLs. It is shipped in the package for demonstrations and is used by the HTTP verification scripts. The agent author guide walks through
it: [Build an agent for Taskbay](../guides/build-an-agent-for-taskbay.md).

## HTTP verification scripts

`npm run test:http` runs these in order. Each starts a real production server on a private port (overridable; see
[Configuration](configuration.md#variables-used-only-by-tests-and-scripts)) with a temporary database and fixture agents, then asserts behavior over
HTTP: `verify-service-security`, `verify-task-http`, `verify-identity-http`, `verify-decisions-http`, `verify-workflow-http`,
`verify-notifications-http`, `verify-forms-http`, `verify-agui-http`, `verify-a2ui-http`, `verify-agent-approvals-http` and `verify-phase6-exit-http`.
They need a completed `npm run build` and, for the PostgreSQL variants, `A2A_TEST_POSTGRES_URL`. A non-zero exit means an assertion failed.

## Limits

- The launcher is single-user and single-process. It cannot run PostgreSQL profiles with local mode on a shared host, and it has no daemon or service mode.
- There is no `agent-taskbay` command for provisioning, credentials or migrations; those are repository scripts, so a production deployment needs the
  source tree (or a build of it) with its dependencies installed.
- Scripts that open PGlite directly require the web server to be stopped.

## Related

- [Configuration reference](configuration.md)
- [Quickstart](../quickstart.md)
- [Running and workers](../operations/running-and-workers.md)
- [Upgrading and backups](../guides/upgrading-and-backups.md)
