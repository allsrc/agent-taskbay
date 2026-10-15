---
id: T-10
title: Discovery mode, status and disclosure in the console
phase: 2
status: todo
depends_on: [T-08, T-26]
size: M
gap: G5
migration: no
updated:
---

# T-10. Discovery settings and disclosure

## Goal

An administrator can see and change an agent's discovery mode, understands what each mode does, and is told in plain words when connecting an agent.

## Read first

- [UI-DESIGN.md "Agent page" and "Connect agent dialog"](../UI-DESIGN.md#agent-page) and [DECISIONS.md D-02](../DECISIONS.md).
- `src/app/agents/[agentId]/page.tsx`, `src/components/agents/connect-agent-dialog.tsx`, `src/app/api/agents/[agentId]/route.ts`, `src/app/api/agents/route.ts`, `src/store/agent-store.ts`, `src/lib/agent-registry.ts`.
- `src/server/runtime/identity.ts`, `docs/reference/http-api.md` (route documentation style).
- T-07's `effectiveTaskDiscovery`, and T-06's settings route.

## Scope

1. **Settings route.** Extend `PATCH /api/agents/:id/settings` (role `administer`, from T-06) with `taskDiscovery: "off" | "browse" | "auto"` and `taskDiscoveryHistoryDays` (0–90). Strict zod validation. A mode above the deployment cap returns `409 DISCOVERY_CAPPED` naming the cap. On a mode change: persist, audit `task.discovery.mode_changed` `{ from, to }`, clear `task_discovery_paused_reason` when entering `auto`, and (once T-25 lands) start or stop sweep cursors. Until T-25 lands, selecting `auto` is rejected with `409 NOT_AVAILABLE`; T-25 removes that guard.
2. **Status route.** `GET /api/agents/:id/discovery` (role `read`): `{ mode, effectiveMode, cap, historyDays, pausedReason, listing: "supported" | "unsupported" | "unknown", auto: { lastCheckedAt, lastFullSweepAt, foundTotal } | null, canBrowse }`. `canBrowse` is true when the caller may operate on the whole agent and the effective mode allows browsing. `listing` comes from the newest list cursor if any, else `unknown`. No agent-supplied text.
3. **Agent page card** per UI-DESIGN: mode radio group (admin editable, others read-only), cap explanation on disabled options, the **Browse tasks on this agent** button (T-26 added a plain button for the dialog in the page header actions; move it into this card and remove the header one), history and status lines for Automatic only. Optimistic updates roll back on failure with an inline error.
4. **Connect dialog.** Add the notice (no checkbox) on the confirm step. Show the "turned off for this deployment" variant when the cap is `off`. The cap must reach the browser through an existing config or session endpoint, not a new one.

## Acceptance criteria

1. Non-admin `PATCH` → `403`; invalid body → `400` with a field message; mode above the cap → `409 DISCOVERY_CAPPED`; valid → persisted and audited.
2. Changing the mode changes what `GET …/remote-tasks` allows (T-08): `off` → `409`, `browse` → works.
3. Status route: `listing = unsupported` for the scenario agent with `noList`; `canBrowse` false for a skill-scoped principal and for a viewer.
4. Connect dialog shows the correct notice for both caps.
5. Component tests: each mode, read-only for non-admin, disabled options under a cap, save failure rollback, unsupported listing text.
6. At 360 px width the card does not overflow.

## Tests

Component tests for the card and dialog notice; DB/HTTP for the routes (roles in `scripts/verify-identity-http.mjs`, behavior in `verify-task-http.mjs`).

## Documentation

- `docs/guides/configuration-recipes.md`: a recipe "Limit or turn off task discovery" (add it to the recipe table at the top), now that the variable is enforced.
- `docs/guides/connect-an-agent.md`: "Task discovery": the three modes, what Browse only does, who may browse, that nothing is stored until tracking, how to change the mode.
- `docs/guides/use-the-console.md`: Agents screen: the card and its states.
- `docs/guides/teams-and-grants.md`: browsing and tracking need operate on the whole agent; skill-scoped grants never see tracked or discovered tasks.
- `docs/reference/http-api.md`: the two routes and their errors.
- `docs/security/threat-model.md`: match T-08's text to the final controls.
- `CHANGELOG.md`: Added.

## Out of scope

The browse dialog (T-26), the automatic sweep (T-25), badges (T-11).

## Notes for later

## Implementation log
