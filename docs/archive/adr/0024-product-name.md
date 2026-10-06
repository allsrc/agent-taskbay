# ADR 0024: Product name — Agent Taskbay

- Status: Accepted
- Date: 2026-10-06
- Requirements: none (naming only; no behavior change)

## Context

The product is the human side of working with production agents: start work, track it after the browser closes, step in when an
agent needs input or approval, and keep an audit record. Its name should say something about that job, be findable by the words
people search ("agent", "task", "human in the loop", "A2A"), and be unclaimed. Candidate names were checked against GitHub, npm,
PyPI, web search and DNS; trademarks and domain registration could not be checked from the build environment.

## Decision

- **Display name:** Agent Taskbay (prose, UI, README title). The bare "Taskbay" is not used: `taskbay.com` and `.app` belong to
  someone else, while the `agenttaskbay.*` names were unclaimed.
- **Slug:** `agent-taskbay` (GitHub repository, npm package name).
- **Tagline:** "The human operations console for A2A agent workflows." Search keywords live in the tagline, package keywords, GitHub
  topics and the README introduction.
- The `A2A_*` environment variable prefix refers to the protocol, not the product, and is unchanged.
- **Wire and persisted identifiers** use the product slug:
  - Extension URIs `https://extensions.allsrc.dev/agent-taskbay/{structured-form,approval-request,skill-routing}/v1`. They are
    identifiers; documentation for each is in [`docs/extensions`](../extensions). `extensions.allsrc.dev` is a shared host for
    extension specifications, with one path segment per project.
  - Media types `application/vnd.agent-taskbay.form+json` and `application/vnd.agent-taskbay.approval-request+json`.
  - Webhook headers `X-Agent-Taskbay-Delivery`, `-Timestamp` and `-Signature`.
  - Development identity issuer `agent-taskbay:development` and OIDC flow `typ` `agent-taskbay:oidc-flow:v1`.
  - Browser storage keys `agent-taskbay.*`.
  - Migration table `agent_taskbay_migrations` and archived-event metadata key `agentTaskbayObject`.

## Consequences

- Extension URIs are permanent once agents advertise them. An incompatible change ships as a new version path; published versions
  are never edited.
- The extension URIs depend on the `allsrc.dev` domain staying registered. The URI does not need to resolve for the extensions to
  work, but the specifications should be published there.
- Webhook receivers key off the `X-Agent-Taskbay-*` headers, so renaming them later is a breaking change for receivers.
