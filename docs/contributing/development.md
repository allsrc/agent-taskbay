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

To check how chat shows content an agent labels with the wrong media type, run `node scripts/fixture-content-agent.mjs 4011` and register
`http://127.0.0.1:4011/card.json`; see the [CLI reference](../reference/cli.md#fixture-agent-script).

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

### Test and verification variables

These are read by the repository's tests and verification scripts, not by the application, so they are not in the [configuration reference](../reference/configuration.md).

| Variable | Used by |
| --- | --- |
| `A2A_TEST_POSTGRES_URL` | Database tests (`npm run test:db`) and HTTP verification scripts; a PostgreSQL URL for a disposable test database. |
| `A2A_HTTP_TEST_PROFILE`, `A2A_IDENTITY_HTTP_TEST_PROFILE`, `A2A_HTTP_TEST_KEEP_SERVER` | `scripts/verify-*-http.mjs` |
| `A2A_*_HTTP_TEST_PORT` (`A2A_HTTP_TEST_PORT`, `A2A_AGUI_HTTP_TEST_PORT`, `A2A_A2UI_HTTP_TEST_PORT`, `A2A_FORMS_HTTP_TEST_PORT`, `A2A_DECISIONS_HTTP_TEST_PORT`, `A2A_IDENTITY_HTTP_TEST_PORT`, `A2A_WORKFLOW_HTTP_TEST_PORT`, `A2A_NOTIFICATIONS_HTTP_TEST_PORT`, `A2A_AGENT_APPROVALS_HTTP_TEST_PORT`, `A2A_PHASE6_EXIT_HTTP_TEST_PORT`, `A2A_DISCOVERY_HTTP_TEST_PORT`, `A2A_STEERING_HTTP_TEST_PORT`, `A2A_EXTENDED_CARD_HTTP_TEST_PORT`) | Port overrides for the matching script. |
| `A2A_SERVICE_FIXTURE_DIR` | `scripts/verify-service-security.mjs` |
| `A2A_PACKAGE_TARBALL` | `scripts/verify-package.mjs`: reuse an existing tarball. |

## Repository layout

| Path | Contents |
| --- | --- |
| `src/app/` | Next.js routes: pages, and HTTP handlers under `src/app/api/` |
| `src/components/`, `src/store/`, `src/lib/` | UI, client state and shared helpers (gateway, URL safety, A2UI, rendering) |
| `src/components/ui/`, `patterns/`, `theme/`, `navigation/`, `brand/`, `src/styles/globals.css` | The http2xx design system (see [User interface](#user-interface)) |
| `src/server/domain/` | Domain models and rules; no framework or database imports |
| `src/server/application/` | Use cases and services behind ports |
| `src/server/adapters/` | Implementations: `db` (MikroORM, migrations), `a2a`, `auth`, `blob`, `live`, `notify`, `agui` |
| `src/server/runtime/` | Wiring of use cases to adapters per request |
| `src/server/workers/` | Background loops (commands, subscriptions, push, reconciliation, decisions, notifications, freshness) |
| `bin/` | The `agent-taskbay` launcher |
| `scripts/` | Operator CLIs (`*.ts`), fixture agents (including the controllable `fixture-scenario-agent.mjs`, see the [CLI reference](../reference/cli.md#fixture-agent-script)), and `verify-*` end-to-end checks |

## Boundaries

- Domain and application code never import React, Next.js, MikroORM or a database driver. New persistence goes behind a port with an adapter.
- Migrations are additive. Create one with `npm run db:migration:create`. Migrations are numbered, not timestamped: the generator names the next one `Migration<nnnn>_<name>`. The generator writes a CommonJS `.cjs` file; rename it to `.js` and change it to ESM (`import { Migration } from "@mikro-orm/migrations"` and `export class …`), as `Migration0001_Baseline.js` and `Migration0002_TaskDiscovery.js` are, so migration names are recorded the same way. Raise `DB_SCHEMA_VERSION` in `src/server/adapters/db/schema-version.ts` to that number in the same change (a test fails otherwise). Do not edit a released migration, the baseline included.
- Browser code never receives agent credentials; credentials are resolved on the server.
- Security-relevant changes (authentication, credentials, outbound requests, webhooks, artifacts) update the [threat model](../security/threat-model.md) and add a regression test.

## User interface

The console uses the http2xx design system: Tailwind 4 with Base UI primitives, tokens in `src/styles/globals.css`, and a light and dark theme stored under `agent-taskbay-theme`. Rules when you change the UI:

- Take colors from the semantic tokens (`bg-card`, `text-muted-foreground`, `text-brand-text`, `bg-signal`). Do not write hex values, `oklch()` or Tailwind palette classes.
- Status colors are tones (`brand`, `success`, `warning`, `danger`, `info`, `neutral`). Task and approval states map onto them in `src/lib/task-view.ts` and `src/lib/approvals.ts`.
- Use the existing primitives and patterns (`Button`, `Dialog`/`ResponsiveDialog`, `Panel`, `EmptyState`, `Pill`). Buttons that navigate use `buttonVariants` on a link; Base UI has no `asChild`, it uses `render`.
- Components in `ui/`, `patterns/`, `theme/` and `navigation/` come from the design system. Add product-specific components next to the feature that needs them. The one addition to `ui/` is `NativeSelect`, for plain forms that read values with `FormData`.
- Screens are built from `src/components/console/`. `Page` is a full page (design-system header, width-limited container). `MasterDetail`, `ListPane`, `ListRow` and `ListStatus` build list-and-detail screens (Tasks, Inbox, Approvals, Agents). Do not hand-roll a scroll container.
- Layout is responsive by default. From `md` up the screen fills the viewport and each pane scrolls on its own. On a phone the document scrolls, the top bar shows a back button for detail screens (see `parentOf` in `app-shell.tsx`) and the tab bar stays fixed. Check a new screen at phone width, and make sure nothing makes the page scroll sideways.

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
