---
id: T-17
title: Fetch and show the extended Agent Card
phase: 4
status: done
depends_on: [T-01, T-03]
size: M
gap: G6
migration: yes
updated: 2026-10-15
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

- 2026-10-15 · done: branch plan/T-17-extended-agent-card; npm run check passed; browser desktop and phone verified; PostgreSQL variant skipped locally
Implemented on `plan/T-17-extended-agent-card`.

- Added `Migration0007_ExtendedCardKind` using the migration generator, converted to ESM, and raised `DB_SCHEMA_VERSION` to 7. Existing snapshots default to `public`; all existing snapshot readers still use `findLatestCardSnapshot`, which now selects only public cards. Extended reads are separate and organization-scoped.
- Added `FetchExtendedCardService`, an `ExtendedCardGateway` port and A2A adapter, runtime wiring, and the administrator-only `POST /api/agents/{agentId}/extended-card/refresh` route. It uses the existing agent credential and public-security limiter (30 per minute across instances). The actual T-03 kind is `extended_card_not_configured`; it returns a neutral result without writing a snapshot or logging the remote error.
- Hardened the existing `extendedCard` gateway operation: a 2 MiB response budget before SDK parsing, the same safe-URL checks as public discovery, and pinned signature verification before redaction and storage. Invalid, untrusted and required-but-missing signatures are rejected. Protected errors remain generic.
- Catalog and individual-agent responses expose an optional `extendedCard` display with skill descriptions, a fetch time and streaming/push booleans. Only the agent detail screen merges these skills; chat and grant selectors retain their public views. Grant creation and skill routing reject extended-only skills, including an extended fetch before the first stored public discovery.
- Added the Fetch/Refresh row, progress/unavailable/failure/retry states, timestamp, authenticated capability display and extra skill pills. The `showcase` demo agent supports the flow. Browser verification fetched the demo card successfully at 1200px and inspected it at 390px; neither viewport overflowed horizontally.
- Tests: `extended-card.test.ts` (view merge and minimized display), `extended-card-gateway.test.ts` (URL and size limits, pinned valid/tampered/forged signatures, credential echo redaction), `extended-card-row.test.tsx` (row states), `extended-card.db.test.ts` (upgrade, restart, public reader/routing/grant isolation, whole-agent versus skill-only reads, two organizations), `verify-extended-card-http.mjs` (fetch, persistence, neutral refusal, invalid-card non-storage, limiter), and non-admin route refusals in `verify-identity-http.mjs`. Both new integration suites are in the explicit npm script chains.
- Updated connect/use guides, HTTP/data/compatibility/CLI references, threat model, upgrade notes and changelog. Relative documentation links resolve; the simple checker finds an existing inline-code `[label](url)` example in CHANGELOG, which is not a document link.
- Verification: `npm run check` passed (561 unit tests, 44 database tests, migrations, schema drift check, production build, all HTTP suites including the new extended-card suite). Focused suites and TypeScript also passed. PostgreSQL test variants are present but skipped locally because `A2A_TEST_POSTGRES_URL` is unset and the Docker daemon is unavailable.

Hosting profiles and deviations:

- Rules 1, 3, 6 and 9: snapshots and rate budgets live in the database; display reads enforce organization and whole-agent grants. Both database variants use the same migration/isolation contract; only PGlite ran here. No secrets or raw extended cards are returned to the browser. Rules 2 and 7 require no new worker: this is an on-demand read with per-request adapters. Rule 5 is exercised by the showcase demo. Rule 8 adds visible fetch status and retry, with no background behavior.
- Rule 4 needs a deployment sequence: although the new column has a safe default, an old instance would read the newest extended snapshot as public. Upgrade all web and worker instances before the first extended fetch; mixed-version operation after an extended snapshot is written is unsupported. This is recorded in the upgrade guide.
- Extended display is restricted to whole-agent readers rather than disclosing extra skills to a principal with only a skill grant. Such readers keep the existing restricted public view.
- The 2 MiB wire budget includes the protocol envelope, so a card exactly at the public-card limit may be refused slightly earlier. This bounds parsing before trusting the SDK result and is documented.
