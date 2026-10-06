# Contributing to Agent Taskbay

Thanks for helping. This page is the short version; the details are in [`docs/contributing/`](docs/contributing/).

## Get started

You need Node.js 22.19 or newer (`.nvmrc` pins the version CI uses).

```bash
git clone https://github.com/allsrc/agent-taskbay.git
cd agent-taskbay
npm ci
npm run dev
```

Open `http://localhost:3002`. No database server or `.env` file is needed. See [development setup](docs/contributing/development.md) for sample agents, PostgreSQL tests and the repository layout.

## Before you open a pull request

```bash
npm run check
```

This runs lint, unit tests, database contract tests, the migration and schema checks, the production build and the HTTP suites. CI runs the same, plus the package check, and must be green.

## Rules that matter in review

- Keep the change focused, and add or adjust tests in the same change.
- Update the docs page that describes the behavior you changed. [Which page](docs/contributing/documentation.md) depends on what you touched; note it in the pull request.
- Respect the code boundaries: domain and application code do not import React, Next.js, MikroORM or a database driver. Migrations are additive.
- Security-relevant changes (authentication, credentials, outbound requests, webhooks, artifacts) update the [threat model](docs/security/threat-model.md).
- User-visible changes go in [`CHANGELOG.md`](CHANGELOG.md).
- Next.js in this repository has breaking changes from older versions. Read the relevant guide in `node_modules/next/dist/docs/` before changing Next.js code.
- By contributing you agree your work is released under the [MIT License](LICENSE).

`docs/archive/` holds the former planning documents. They are history; do not edit them.

## Reporting problems

- Bugs and feature ideas: open an issue using a template.
- Vulnerabilities: do not open a public issue; follow [`SECURITY.md`](SECURITY.md).
- Conduct: see [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
