# ADR 0025: npm distribution and the local launcher

- Status: Accepted
- Date: 2026-10-06
- Requirements: OPS-003, DX-001, OSS-001, OPS-001
- Amends: ADR 0014 (outbound origin allowlist in explicit demo mode), ADR 0007 (migrations are no longer only an explicit step for the
  embedded local profile)

## Context

Today a developer has to clone the repository, install development dependencies, copy `.env.example`, run `npm run db:migrate` with the web
process stopped, and then `npm run dev`. The product promise (ADR 0001, ARCHITECTURE "Local" profile) is a zero-install local profile:
embedded PGlite, local artifact directory, development identity and embedded workers in one long-running Node process. Nothing packaged
that profile, so the promise could not be tried in one command.

Constraints found while designing it:

- The Next.js production build treats `NODE_ENV=production` as a hardened profile: development identity is refused unless
  `A2A_ALLOW_DEVELOPMENT_AUTH=true`, private network targets are blocked, and `validateTargetUrl` demands an exact origin allowlist
  even in explicit demo mode. A plain launch therefore could not add an agent from the UI, including the sample agents on loopback.
- `output: "standalone"` was considered first. npm silently drops every `node_modules` directory from a tarball, so a standalone
  bundle with its traced dependencies cannot be published as-is without renaming and restoring it at run time.
- The credential vault needs a key ring (`A2A_VAULT_KEYS`) before any agent credential can be stored.
- PGlite has a single owner, so a second process on the same directory fails with a database error that does not explain itself.

## Decision

- Publish **one** package, `agent-taskbay`, on npm. It contains the Next.js production build (`.next`), the launcher, the migrations and the
  sample agent. Its runtime dependencies are the project's `dependencies`, installed by npm normally. `npx agent-taskbay` is the supported
  local entry point. The package is published from CI with npm provenance on a version tag; `private` is removed from `package.json`.
- The launcher (`bin/agent-taskbay.mjs`, logic in `bin/launcher.mjs`) starts `next start` as a child process and never imports application
  code. It:
  - binds `127.0.0.1` by default and **refuses** to start development identity on any non-loopback address; listening elsewhere requires
    OIDC configuration (ADR 0013);
  - keeps all state under one data directory (`~/.agent-taskbay` by default, `--data-dir` or `A2A_DATA_DIR` to change): PGlite, artifacts
    and `secrets.json`;
  - generates the vault key ring once into `secrets.json` (mode 0600), never overwrites it and never prints it;
  - sets `A2A_AUTH_MODE=development`, `A2A_ALLOW_DEVELOPMENT_AUTH=true` and `A2A_ALLOW_PRIVATE_NETWORKS=true` only when OIDC is not
    configured, and lets any value the operator already set win;
  - refuses a second instance on the same data directory through a pid file;
  - provides `demo-agent`, which serves the reference fixture agents so a new user has something to connect.
- Add `A2A_AUTO_MIGRATE=true` (default off). When set, runtime database initialization applies pending migrations before bootstrapping.
  The launcher sets it for the PGlite profile only. PostgreSQL deployments with several replicas keep migration as an explicit step
  because concurrent migrators are not guaranteed to be safe.
- Amend ADR 0014: **explicit demo mode** (`A2A_AUTH_MODE=development` and `A2A_ALLOW_DEVELOPMENT_AUTH=true`) no longer requires an
  origin allowlist, matching its existing exemption from the HTTPS requirement. A configured `A2A_ALLOWED_AGENT_ORIGINS` is still
  enforced, and every other production profile still requires one. Demo mode already grants an unauthenticated administrator, so this
  adds no capability that an attacker who can reach it did not have; the launcher's loopback guard is the control that matters.
- Hosting images, Helm charts and an S3/KMS adapter are out of scope here; see
  [`docs/deployment/PRODUCTION_TOPOLOGY.md`](../deployment/PRODUCTION_TOPOLOGY.md).

## Alternatives rejected

- **Standalone output.** Smaller install, but npm strips `node_modules` from tarballs, so it needs a rename-and-restore step that every
  Next.js upgrade can break. Revisit if install size becomes a real problem.
- **Publishing the gateway as a separate A2A client library.** `@a2a-js/sdk` already covers the protocol; see ADR 0026.
- **Generating a random admin password for local mode.** The identity adapter has no password concept, and loopback binding already
  limits exposure; adding one would be a new authentication path for a development convenience.

## Consequences

- A user can try the product with one command and no clone. The package is large because Next.js and its dependencies are installed.
- `scripts/verify-package.mjs` is the exit check: it packs the project, installs the tarball into an empty directory, launches it and
  drives the HTTP API through registration, command dispatch and a restart. It runs in CI as its own job.
- The build in the tarball is made with the maintainer's Node version; `engines` is `>=22.17.0`.
- Provenance and the first publish require an npm token and a version tag, which only the maintainer can supply.
