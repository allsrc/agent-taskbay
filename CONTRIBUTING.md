# Contributing to Agent Taskbay

Thanks for helping. This project is spec-driven: product scope, architecture and phase order live in the repository, not in chat or
issue threads. A change that fits the current phase and passes the checks below is easy to review.

## Set up

You need Node.js 22.19 or newer (`.nvmrc` pins the version CI uses).

```bash
git clone https://github.com/allsrc/agent-taskbay.git
cd agent-taskbay
npm ci
npm run dev        # http://localhost:3002
```

`npm run dev` needs no database server and no `.env` file. It uses an embedded PGlite database under `.data/`, applies migrations on
start, and signs you in as a clearly labelled development administrator. Copy `.env.example` to `.env.local` to change anything.

To try it against agents, serve the sample ones in a second terminal and connect a card URL from the console:

```bash
node scripts/fixture-form-agent.mjs 4010     # prints the Agent Card URLs
```

## Check your change

```bash
npm run lint
npm test                 # unit tests
npm run test:db          # database contract tests (PGlite; add PostgreSQL below)
npm run db:schema:check  # migrations match the entities
npm run build
npm run test:http        # needs the production build; runs fixture agents and restarts the server
npm run check            # all of the above
```

Database tests also run against PostgreSQL when `A2A_TEST_POSTGRES_URL` is set, as CI does. A disposable server is enough:

```bash
docker run -d --name taskbay-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:18-alpine
export A2A_TEST_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres
```

The test account needs permission to create and drop its temporary test databases.

To check the published package (packs the project, installs the tarball into an empty directory, launches it and drives the API):

```bash
npm run verify:package
```

## How work is organised

Read these in order before planning a change; `AGENTS.md` has the same list:

1. [`docs/spec/README.md`](docs/spec/README.md): authority order and execution rules.
2. [`docs/spec/PRODUCT_SPEC.md`](docs/spec/PRODUCT_SPEC.md): requirements (stable IDs such as `HITL-003`) and non-goals.
3. [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`docs/spec/DATA_MODEL.md`](docs/spec/DATA_MODEL.md).
4. [`ROADMAP.md`](ROADMAP.md), [`docs/spec/STATUS.md`](docs/spec/STATUS.md) and [`docs/spec/PHASES.md`](docs/spec/PHASES.md).
5. The accepted decisions in [`docs/adr/`](docs/adr/).

Rules that matter in review:

- **One vertical slice per change**, with tests in the same change. Mention the requirement ID in a test name or nearby comment when the
  link is not obvious.
- **Update `docs/spec/STATUS.md`** (and the checklist in `PHASES.md`) in the same change, with the verification you ran. Check a box only
  after verifying it.
- **Add an ADR** when a change alters an accepted decision. Do not silently contradict one. Number it next in `docs/adr/` and add it to the index.
- **Respect the boundaries** in `ARCHITECTURE.md`: domain and application code never import React, Next.js, MikroORM or a database driver.
  New persistence goes behind a port with an adapter; new migrations are additive.
- **Next.js here is not the one you may know.** Read the relevant guide in `node_modules/next/dist/docs/` before changing Next.js code.
- **Security-relevant changes** (authentication, credentials, outbound requests, webhooks, artifacts) need a note in
  `docs/security/THREAT_MODEL.md` or the relevant ADR. See also [`SECURITY.md`](SECURITY.md).

## Pull requests

- Branch from `main`; keep the change focused.
- Use the pull request template. Describe what changed and how you verified it.
- CI runs lint, tests, the PostgreSQL database contracts, the build, the HTTP suites and the package check. It must be green.
- By contributing you agree your work is released under the [MIT License](LICENSE).

## Reporting problems

- Bugs and feature ideas: open an issue using a template.
- Vulnerabilities: do not open a public issue; follow [`SECURITY.md`](SECURITY.md).
- Conduct: see [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
