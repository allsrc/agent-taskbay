# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [semantic versioning](https://semver.org/) once it reaches 1.0; until then minor versions may change interfaces.

## [Unreleased]

Nothing yet.

## [0.1.1] - 2026-10-07

Documentation and release-process release. No runtime behavior changed.

### Changed

- The README and documentation are rewritten around the questions a reader brings: a quickstart, concepts, task guides, reference pages
  (configuration, CLI, HTTP API, extensions, compatibility and known limitations), operations and troubleshooting, a threat model and an
  honest status page. The earlier planning documents are kept in `docs/archive/`.
- The README now leads with `npx agent-taskbay`, and states plainly what the project does not do.
- Releases are published from GitHub Actions with npm trusted publishing (OIDC) and provenance; no npm token is stored. The GitHub release
  notes are taken from this changelog.

## [0.1.0] - 2026-10-07

First release, published to npm. For what works today and what does not, see [`docs/project/status-and-roadmap.md`](docs/project/status-and-roadmap.md).

### Added

- `npx agent-taskbay`: a local launcher that starts the console with an embedded database, generated vault keys and a development
  administrator, bound to loopback only. `agent-taskbay demo-agent` serves sample A2A agents to connect ([decision record](docs/archive/adr/0025-npm-distribution-and-local-launcher.md)).
- `A2A_AUTO_MIGRATE`: apply pending migrations when the server starts. On by default for `next dev` with PGlite and for the launcher.
- Community files: contributing guide, code of conduct, security policy, issue and pull request templates, Dependabot, and a release
  workflow that publishes to npm with provenance.
- [`docs/archive/deployment/PRODUCTION_TOPOLOGY.md`](docs/archive/deployment/PRODUCTION_TOPOLOGY.md): the intended production topology and artifact-storage options.
- [ADR 0026](docs/archive/adr/0026-taskbay-client-sdk.md) records the parked proposal for a Taskbay client SDK ([#31](https://github.com/allsrc/agent-taskbay/issues/31)).

### Changed

- Production builds use webpack (`next build --webpack`) so the build can be shipped through npm. Development still uses Turbopack.
- In explicit demo mode (development identity on a production build) the outbound origin allowlist is no longer mandatory; a configured
  allowlist is still enforced and every other production profile still requires one (amends [ADR 0014](docs/archive/adr/0014-service-credentials-and-scoped-security.md)).
- `package.json` is publishable: `private` removed, `bin`, `files` and `publishConfig` added, duplicate `keywords` merged.
