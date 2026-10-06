# ADR 0024: Product name — Agent Taskbay

- Status: Accepted
- Date: 2026-10-06
- Requirements: none (naming only; no behavior change)

## Context

The project was called **A2A Ops** (formally "A2A Operations Console"). The name described a protocol and an activity,
but not the product's job, and it was not distinctive. The product is the human side of working with production agents:
start work, track it after the browser closes, step in when an agent needs input or approval, and keep an audit record.

Naming goals, in priority order: people should find it by the words they search ("agent", "task", "human in the loop",
"A2A"); the name should be plain and say something about the job; and it should be unclaimed. Many candidates were rejected
because a company, repository or package already used them (checked on GitHub, npm, PyPI, web search and DNS; trademarks and
domain registration were not checkable from the build environment).

## Decision

- **Display name:** Agent Taskbay (prose, UI, README title). The bare "Taskbay" is not used: `taskbay.com` and `.app` belong to
  someone else, while the `agenttaskbay.*` names were unclaimed.
- **Slug:** `agent-taskbay` (GitHub repository, npm package name). `agenttaskbay` was also free on npm.
- **Tagline:** unchanged — "The human operations console for A2A agent workflows." Search keywords live in the tagline, package
  keywords, GitHub topics and the README introduction.
- "A2A Operations Console" is no longer used as a formal name.
- The `A2A_*` environment variable prefix is unchanged: it refers to the protocol, not the product.

## Compatibility identifiers kept on purpose

Renaming these breaks agents, webhook receivers or stored data, and none of them affects discovery. They are unchanged and
tracked for one coordinated change in [#27](https://github.com/shashikanth-gs/a2a-ops/issues/27), before the extensions are proposed
upstream (#19):

- Extension URIs `https://a2a-ops.dev/extensions/{structured-form,approval-request}/v1` and `urn:a2a-ops:skill-routing:1`.
- Media types `application/vnd.a2a-ops.form+json` and `application/vnd.a2a-ops.approval-request+json`.
- Webhook headers `X-A2A-Ops-Delivery`, `-Timestamp`, `-Signature`.
- Dev identity issuer `a2a-ops:development` (stored), OIDC flow `typ` `a2a-ops:oidc-flow:v1`.
- Browser storage keys `a2a-ops.*` and the legacy `a2a-agent-workflow-ui.*` migration source.
- The `a2a_ops_migrations` table name and the archived-event metadata key `a2aOpsObject`.

Extension URIs embed `a2a-ops.dev`, a domain that may not be owned. The domain decision is deferred (the project does not
register domains yet); it blocks only the URI and media-type rename.

## Consequences

- Visible names change in the UI, README, specifications and package metadata. Accepted ADRs 0001–0023 keep their original wording
  ("A2A Ops") as a record of what was decided; they refer to the same product.
- Existing GitHub issue and pull request links keep working through GitHub's redirect once the repository is renamed
  (a repository setting, done after this change merges). Links in the docs still use the old repository path until then.
- Historical evidence in `docs/spec/STATUS.md` keeps the old name.
- A repository rename redirects the old URL only while no new repository takes the old name.
