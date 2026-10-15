---
id: T-18
title: Show the negotiated connection and choose a tenant
phase: 4
status: todo
depends_on: [T-06, T-02]
size: M
gap: G12
migration: no
updated:
---

# T-18. Connection details and tenant choice

## Goal

People can see which interface, protocol version and extensions a connection uses, and choose among the tenants an agent advertises, so "wrong version, binding or tenant" is diagnosable.

## Read first

- [UI-DESIGN.md "Agent page"](../UI-DESIGN.md#agent-page).
- `src/lib/gateway.ts` (`selectAdvertisedInterface`, `dedupeSupportedInterfaces`, `createClient`), `src/lib/agent-card.ts`, `src/app/agents/[agentId]/page.tsx`, `src/components/chat/options-panel.tsx`, `src/components/chat/chat-view.tsx`.
- T-02's answer to question 2 (where tenant comes from today).
- `docs/guides/connect-an-agent.md` (pinning binding, URL, version).

## Finding from T-02 (already proved by `src/lib/gateway-tenant.test.ts`)

Taskbay sends and stores an empty tenant for a new conversation (`chat-view.tsx` passes `tasks[0]?.tenant`, undefined at first). The SDK client then fills in the selected interface's tenant on the wire (`TenantTransportDecorator` / `defaultTenant`). So the agent sees `acme` while Taskbay's `tasks.tenant` is `""`. For an agent with one tenant this works and is consistent. For an agent whose card lists several tenants the person cannot choose, and the stored tenant does not say which one was used. Decide in this task whether to store the effective tenant (preferred: resolve the tenant from the selected interface at send time and store it, so identity matches the agent's) and test both single- and multi-tenant agents.

## Scope

1. Extend the agent view with `connection: { binding, interfaceUrl, protocolVersion, tenant, tenants[], pinned: boolean, negotiated[], ignored[], required[], unsupportedRequired[] }`. Values come from the stored card snapshot and the saved connection config; the interface is the one `createClient` would pick (extract that selection into a pure function used by both).
2. **Connection card** (read-only `DefinitionList`; extension list expandable) per UI-DESIGN. Replace the old "Interfaces" card; keep binding chips.
3. **Tenant choice.** If the card's interfaces declare more than one tenant, the chat options panel shows a tenant selector for **new conversations**; an existing conversation keeps its tenant. If there is exactly one, use it silently; if none, the empty tenant. This must match T-02's finding; if T-02 showed new conversations already pick correctly, only add the selector.
4. Agent-supplied strings (interface URL, extension URIs) render as text, never links.

## Acceptance criteria

1. Scenario agent with `tenants: ["acme", "beta"]`: the selector offers both; a new conversation's first send uses the chosen tenant (assert the agent's request log); an existing conversation does not change tenant.
2. With a pinned binding the card says "Pinned by your connection settings".
3. Required-but-unsupported extension shows the pill from T-06 in this card too.
4. Phone width and dark theme checked.

## Tests

- Unit: the interface-selection function (table-driven, including pinned and legacy v0.3 cards). Component: card and selector.

## Documentation

- `docs/guides/connect-an-agent.md`: reading the Connection card; tenants.
- `docs/guides/use-the-console.md`: the tenant selector.
- `docs/reference/compatibility.md`: multi-tenancy row.
- `CHANGELOG.md`: Added.

## Out of scope

Changing how the SDK negotiates.

## Notes for later

## Implementation log
