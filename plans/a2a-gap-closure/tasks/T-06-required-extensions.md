---
id: T-06
title: Honor required extensions on the Agent Card
phase: 1
status: done
depends_on: [T-01, T-03]
size: M
gap: G2
migration: yes
updated: 2026-10-15
---

# T-06. Required extensions

## Goal

If an agent marks an extension `required: true` and Taskbay does not support it, sending to that agent is blocked with a clear reason, unless an administrator explicitly overrides it.

## Read first

- `src/server/sideband/extension.ts` (`advertisedExtensionUris`, `negotiateSidebandExtensions`), `src/server/runtime/runtime-config.ts` (`sidebandExtensionUris`), `src/server/runtime/agent-extensions.ts`.
- `src/lib/compliance.ts` (card report), `src/lib/gateway.ts` `discoverAgent` return value and the `sideband` field.
- `src/server/runtime/commands.ts` `acceptCommandWithin`.
- `docs/reference/extensions/README.md`.
- SDK: the `AgentExtension` type has `required`; check it in `node_modules/@a2a-js/sdk/dist/*.d.ts`.

## Scope

1. **Detection.** Extend the discovery `sideband` result with `requiredUris` (advertised with `required: true`) and `unsupportedRequiredUris` (required and not in `sidebandExtensionUris()`). Keep `advertisedUris` and `negotiatedUris`.
2. **Compliance.** Add an `error`-severity issue `extension.required.unsupported` per URI in `validateAgentCard`'s report path (the report stays advisory: registration still succeeds).
3. **Storage.** The latest card snapshot already holds the card; compute `unsupportedRequiredUris` from it at read time. Do **not** add a column.
4. **Override.** Per-agent `extensionOverride` boolean: column `agents.extension_override` (not null, default false) in a new migration (next free number; `Migration0003_AgentExtensionOverride` if T-03 has landed). `AgentRecord` gains `extensionOverride: boolean`.
5. **Enforcement.** In `acceptCommandWithin`, for `send` only: if the agent has `unsupportedRequiredUris` and no override, throw `CommandError` `409` with `kind: "extension_required"`, body listing the URIs (as data). `cancelTask` is not blocked.
6. **Override API.** `PATCH /api/agents/:id/settings` with `{ extensionOverride: boolean }`, role `administer`, audited as `agent.extension.override` with `{ enabled }`. (T-10 adds the discovery fields to the same route; keep the handler open to extension.)
7. **Negotiation header.** Behavior of sending supported extensions on requests is unchanged.

## Acceptance criteria

1. Unit: card with a required unsupported extension → `unsupportedRequiredUris` lists it; a required **supported** extension does not.
2. Unit: compliance report contains the error issue.
3. DB/HTTP: send to the scenario agent with `requireExtension` returns `409 extension_required` and creates no command; after the override it is accepted; cancel works either way.
4. Audit row `agent.extension.override` exists with actor and value; a non-admin gets `403`.
5. Disabling the override restores blocking.
6. UI (Agent page, see [UI-DESIGN.md](../UI-DESIGN.md#agent-page)): the danger callout and the admin-only switch. T-18 builds the full Connection card; here add only the callout and switch.

## Tests

- Unit: `extension.test.ts` (new) and `agent-card.test.ts`/compliance tests.
- DB: extend `agent-registry.db.test.ts` or `commands.db.test.ts`.
- HTTP: case in `scripts/verify-task-http.mjs`.
- Component test for the callout and switch states (enabled/disabled for non-admin).

## Documentation

- `docs/guides/connect-an-agent.md`: "Required extensions" subsection: what blocks, how to see it, the override and its audit entry.
- `docs/reference/extensions/README.md`: Taskbay's behavior for `required`.
- `docs/reference/http-api.md`: settings route (extension override), `409 EXTENSION_REQUIRED`.
- `docs/reference/compatibility.md`: extensions row.
- `docs/security/threat-model.md`: the override is an audited bypass.
- `CHANGELOG.md`: Changed.

## Out of scope

Connection-details card (T-18). Adding support for more extensions.

## Notes for later

## Implementation log

- 2026-10-15 · done: Migration0004_AgentExtensionOverride.js (agents.extension_override), DB_SCHEMA_VERSION=4. server/sideband/extension.ts: understoodExtensionUris (sideband + form, approval, A2UI, skill routing), requiredExtensionUris, unsupportedRequiredExtensionUris; discovery sideband gains requiredUris/unsupportedRequiredUris; compliance error extension.required.unsupported; acceptCommandWithin blocks send (409 extension_required, details.extensions) unless override, cancel never blocked; PATCH /api/agents/:id/settings (administer) via runtime/agent-settings.ts (changeAgentSettings, audited agent.extension.override / .removed); catalog entries carry extensions {required, unsupportedRequired, override}; RequiredExtensionsNotice on the agent page (admin switch via /api/auth/session role). Tests: extension.test.ts, required-extensions-notice.test.tsx (static render: the repo has no jsdom/testing-library, so the switch interaction is covered by the HTTP suite), required-extensions.db.test.ts (added to test:db; audit rows), verify-task-http.mjs (extreq agent, override on/off, 400/404). All green: lint, tsc, npm test 365, test:db 23 files, build, verify-task-http. Docs: connect-an-agent, extensions README, http-api, data-model, compatibility, threat-model, CHANGELOG. Known limit (documented): the block uses the latest stored card, so a send before any card snapshot exists is not blocked. Not run: PostgreSQL profile.