---
id: T-17
title: Fetch and show the extended Agent Card
phase: 4
status: todo
depends_on: [T-01, T-03]
size: M
gap: G6
migration: yes
updated:
---

# T-17. Extended Agent Card

## Goal

When an agent offers an extended card to authenticated callers, an administrator can fetch it with the agent's credential and see the extra skills and capabilities, without changing what the public card controls.

## Read first

- [ARCHITECTURE.md security rules](../ARCHITECTURE.md#security-rules-for-this-plan) (extended card row).
- `src/lib/gateway.ts` (`extendedCard` action, `discoverAgent` checks: `assertSafeAgentCard`, size limit, `verifyCardTrust`), `src/server/adapters/db/agent-registry.ts` and `repositories.ts` (`findLatestCardSnapshot`, card snapshot save), every caller of `findLatestCardSnapshot` (skill routing in `commands.ts`, extension negotiation, catalog).
- `src/app/agents/[agentId]/page.tsx`, `src/lib/agent-card.ts` (view building), `docs/reference/extensions/skill-routing.md`.
- [DECISIONS.md D-03](../DECISIONS.md) for `ExtendedAgentCardNotConfiguredError`.

## Scope

1. **Migration.** `agent_card_snapshots.kind` text not null default `'public'`; next free number. Add `kind` to the entity and record.
2. **Isolation.** Audit **every** reader of card snapshots. `findLatestCardSnapshot` must keep returning the latest **public** snapshot only; add `findLatestExtendedCardSnapshot`. Add a test that storing an extended snapshot changes nothing for skill routing, extension negotiation or grants.
3. **Fetch.** `fetch-extended-card.ts`: calls the existing `extendedCard` operation with the agent connection; validates with `assertSafeAgentCard`, the 2 MiB limit and signature verification like the public card; stores `kind = 'extended'`. Map `extended_agent_card_not_configured` (T-03 kind) to a neutral "not available" result rather than an error.
4. **Route.** `POST /api/agents/:id/extended-card/refresh` (role `administer`), rate limited with the existing public-security limiter. Response: `{ fetchedAt, skills, capabilities }` of the extended card; the stored card is never returned raw to the browser beyond what the agent page already shows for the public card.
5. **Merge in the view.** The agent view lists extended skills after public ones with an "Authenticated" pill, only for people who may read the agent. Extended skills are **not** selectable for skill-scoped grants or skill routing unless the same skill id also exists in the public card.
6. **UI.** The "Extended card" row on the Capabilities card: **Fetch** (admin) when advertised, then `Fetched <time>` with **Refresh**; states per [UI-DESIGN.md](../UI-DESIGN.md#agent-page).

## Acceptance criteria

1. Scenario agent with `extendedCard` configured: after Fetch, extra skills appear marked "Authenticated"; the public skill list and routing are unchanged.
2. Not configured: neutral message, no error log noise.
3. Unsafe extended card (private-range URL, oversize, bad signature when signing is required) is refused and not stored.
4. A non-admin gets `403`; the limiter returns `429` when abused.
5. Migration upgrade test passes on PGlite and PostgreSQL; `db:schema:check` clean.

## Tests

- Unit: view merge. DB: snapshot kinds and reader isolation. HTTP: route auth and happy path. Component: row states.

## Documentation

- `docs/guides/connect-an-agent.md`: "Extended Agent Card".
- `docs/reference/http-api.md`, `docs/reference/data-model.md`, `docs/reference/compatibility.md` (Extended Agent Card row: no longer "Display only").
- `docs/security/threat-model.md`: extended card handling.
- `CHANGELOG.md`: Added.

## Out of scope

Using extended skills for routing or grants.

## Notes for later

## Implementation log
