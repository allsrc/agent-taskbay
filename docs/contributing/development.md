# Development setup

> Who this is for: someone who wants to change Agent Taskbay. You will have it running from source, know which test layer to use, and know the code boundaries your change must respect.

## Before you start

- Node.js 22.19.0 or newer. `.nvmrc` pins `22.19.0`, which is what CI uses; `package.json` requires `>=22.19.0`.
- npm. No database server and no `.env` file are needed for development.
- For PostgreSQL tests: Docker or any disposable PostgreSQL server (CI uses `postgres:18-alpine`).

## Run it

```bash
git clone https://github.com/allsrc/agent-taskbay.git
cd agent-taskbay
npm ci
npm run dev
```

The console is at `http://localhost:3002`. `npm run dev` uses embedded PGlite under `.data/`, applies migrations on start (`A2A_AUTO_MIGRATE`), and signs you in as a labelled development administrator. Copy `.env.example` to `.env.local` to change settings; see the [configuration reference](../reference/configuration.md).

To give it agents, start the sample ones in a second terminal and register a printed Agent Card URL in the console:

```bash
node scripts/fixture-form-agent.mjs 4010
```

If `npm run dev` fails on an in-use port, something else holds 3002 (the script fixes the port). If it fails with a database error, another process probably owns the PGlite directory; PGlite allows one owner.

## Check your change

```bash
npm run check
```

That runs, in order: `lint`, `test`, `test:db`, `db:migrate`, `db:schema:check`, `build`, `test:http`. You can run the parts alone:

| Command | Layer | Notes |
| --- | --- | --- |
| `npm run lint` | ESLint | |
| `npm test` | Unit tests (Vitest), excluding `*.db.test.ts` | Pure logic, components, adapters with fakes. `npm run test:coverage` adds coverage. |
| `npm run test:db` | Database contract tests (`src/server/adapters/db/*.db.test.ts`) | Run on PGlite; also on PostgreSQL when `A2A_TEST_POSTGRES_URL` is set. Single worker, 30 s timeout. |
| `npm run db:schema:check` | Migrations match the entities | Run `npm run db:migrate` first, as `check` does. |
| `npm run build` | Production build (webpack) | |
| `npm run test:http` | End-to-end HTTP suites (`scripts/verify-*-http.mjs`) | Needs the production build. Starts fixture agents and real production servers, and restarts them. Slow. |
| `npm run verify:package` | Packs the project, installs the tarball into an empty directory, launches it | Needs network access to install dependencies. |

A new database-backed test goes in a `*.db.test.ts` file and must also be added to the explicit file list in the `test:db` script in `package.json`; the script does not glob. A new HTTP suite is added to the `test:http` chain the same way.

### PostgreSQL

CI sets `A2A_TEST_POSTGRES_URL`, `A2A_DATABASE_PROFILE=postgresql` and `A2A_DATABASE_URL`. To reproduce locally:

```bash
docker run -d --name taskbay-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:18-alpine
```

```bash
export A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres
```

The test account must be able to create and drop temporary databases. Use a disposable server, never a real one.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/app/` | Next.js routes: pages, and HTTP handlers under `src/app/api/` |
| `src/components/`, `src/store/`, `src/lib/` | UI, client state and shared helpers (gateway, URL safety, A2UI, rendering) |
| `src/server/domain/` | Domain models and rules; no framework or database imports |
| `src/server/application/` | Use cases and services behind ports |
| `src/server/adapters/` | Implementations: `db` (MikroORM, migrations), `a2a`, `auth`, `blob`, `live`, `notify`, `agui` |
| `src/server/runtime/` | Wiring of use cases to adapters per request |
| `src/server/workers/` | Background loops (commands, subscriptions, push, reconciliation, decisions, notifications, freshness) |
| `bin/` | The `agent-taskbay` launcher |
| `scripts/` | Operator CLIs (`*.ts`), fixture agent, and `verify-*` end-to-end checks |

## Boundaries

- Domain and application code never import React, Next.js, MikroORM or a database driver. New persistence goes behind a port with an adapter.
- Migrations are additive. Create one with `npm run db:migration:create`.
- Browser code never receives agent credentials; credentials are resolved on the server.
- Security-relevant changes (authentication, credentials, outbound requests, webhooks, artifacts) update the [threat model](../security/threat-model.md) and add a regression test.

## Next.js caveat

This project uses a Next.js version with breaking changes from older releases. Before changing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` (as `AGENTS.md` says), and heed deprecation notices. Development uses Turbopack; the production build uses webpack (`next build --webpack`) so the package can ship through npm.

## When it fails

| Symptom | Likely cause |
| --- | --- |
| `test:http` fails at start | No production build; run `npm run build` first (`check` does) |
| `db:schema:check` reports drift | Entities changed without a migration; run `npm run db:migration:create` |
| Service-security suite cannot make certificates | `openssl` is missing from PATH |
| PostgreSQL contract runs do not happen | `A2A_TEST_POSTGRES_URL` unset or the server is unreachable |

## Related

- [Documentation guide](documentation.md)
- [CONTRIBUTING.md](../../CONTRIBUTING.md)
- [CLI reference](../reference/cli.md)
