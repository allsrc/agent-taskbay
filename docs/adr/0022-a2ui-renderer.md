# ADR 0022: A2UI renderer from an allowlisted Basic Catalog subset

- Status: Accepted
- Date: 2026-10-05
- Requirements: INT-002, INT-003, SEC-004, ACC-001

## Context

A2UI (a2ui.org, Google, Apache 2.0) lets an agent describe an interface as declarative JSON that the client renders with
its own components. Research on 2026-10-05 of the v0.9 specification (a2ui.org and the a2ui-project repository):

- Server-to-client envelopes carry `version: "v0.9"` and exactly one of `createSurface` (surfaceId, catalogId, theme,
  sendDataModel), `updateComponents` (a flat component list with an `id: "root"`; children by id), `updateDataModel` (JSON
  Pointer path, value) and `deleteSurface`. Client-to-server messages are `action` (name, surfaceId, sourceComponentId,
  timestamp, context) and `error`.
- Over A2A the extension URI is `https://a2ui.org/a2a-extension/a2ui/v0.9`. A2UI messages travel in a data part (the
  `data` MUST be an array of envelopes); the media type is `application/a2ui+json` from v0.9.1 (`application/json+a2ui` in
  v0.9 documents). Clients declare `a2uiClientCapabilities` (`supportedCatalogIds`) in message metadata, and an invalid
  envelope must not stop the rest of the list from being processed.
- The Basic Catalog (`https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json`) defines Text, Image, Icon, Video,
  AudioPlayer, Row, Column, List, Card, Tabs, Divider, Modal, Button, CheckBox, TextField, DateTimeInput, ChoicePicker and
  Slider, plus functions. The specification does not say what a client does with an unknown component or catalog.
- A2UI is declarative data, not code; the client chooses which catalog components exist.

## Decision

- **Opt-in by extension URI.** Surfaces render only for agents whose card advertises the A2UI extension. Otherwise the part
  stays an ordinary data part. Every message to an advertising agent activates the extension and carries
  `a2uiClientCapabilities` listing only the Basic Catalog, so the agent can choose a catalog we render.
- **Strict envelope validation, tolerant processing.** Each envelope is validated (version, exactly one message key, ids,
  limits); an invalid one is skipped and counted ("n invalid interface updates ignored") and the rest still apply. A
  `createSurface` with another catalog id yields a visible "catalog not rendered" notice and renders nothing from it.
- **Allowlist.** Text, Row, Column, Card, Divider, Button, TextField, CheckBox and ChoicePicker. Any other component
  renders as an inert labelled placeholder, as do template children, unsupported values and nesting beyond 20 levels or
  cycles. Limits: 200 components per surface, 8 surfaces, 64 KB data model, 5,000 characters per text, 50 options.
- **Safe rendering.** Components are React elements chosen by the console; every agent string is rendered as text (no
  Markdown, no HTML). No URL is loaded, followed or opened by the console: Image, Video, AudioPlayer and `openUrl` are not
  rendered or run. Values are a literal or an absolute JSON Pointer; function calls, `checks` and `validationRegexp` are not
  evaluated (a regular expression from an agent is a denial-of-service risk). JSON Pointers that name `__proto__`,
  `constructor` or `prototype` are rejected.
- **Data model.** The agent's `updateDataModel` builds the model; the viewer's input is kept as a separate overlay of
  pointer edits and never sent anywhere until an action. Surfaces are folded from every A2UI part of the task's agent messages
  in order.
- **Actions.** A Button's `action.event` (name, context with literal or bound values resolved from the model, at most 16 KB)
  is sent back through the ordinary send path as one data part of media type `application/a2ui+json` containing the `action`
  envelope on the same task. It is therefore an `operate` command with the same authorization, rate limit, idempotency
  and audit as a typed reply. Buttons are enabled only while the task is not finished; a Button with a local `functionCall`
  action is disabled.
- **Authority.** A surface is the agent's request for input, like an `INPUT_REQUIRED` question. It is never an approval;
  decision requests remain the Phase 4 aggregate (ADR 0015).
- **Sending waits for discovery.** The chat composer is disabled until the agent's card is known, because the card decides
  which extensions the message activates (found in browser verification: a first message could otherwise omit them).

## Consequences

- Agents get working text, input, selection and confirmation UIs now; richer components need the issues below, each with
  its own safety design (notably any URL loading).
- The renderer is chat-only for now; task and approval pages, AG-UI mapping and the update-versus-edit merge rule are tracked.
- Component support is a closed list in code, so a catalog change or a new version is an explicit change, not an accident.

Tracked limitations: remaining components #22, functions/checks/`openUrl`/`sendDataModel` #23, other surfaces and merge rule
#24, real-agent and schema verification #25.
