# ADR 0020: Structured input forms through an advertised extension

- Status: Accepted
- Date: 2026-10-05
- Requirements: INT-002, INT-003, SEC-004, ACC-001

## Context

An agent that needs input today sends free text, optionally with an `options` list that the console shows
as quick replies. Phase 6 adds richer input without replacing the generic A2A composer or the durable
task model, and without letting agent-supplied content run code or bypass authorization.

## Decision

- **Opt-in by extension URI.** An agent card advertises `https://a2a-ops.dev/extensions/structured-form/v1`
  under `capabilities.extensions`. The console renders a form only for agents that advertise it.
- **Carrier.** The form is a data part with media type `application/vnd.a2a-ops.form+json` in the
  `INPUT_REQUIRED` status message: `{ title?, description?, submitLabel?, schema }`. No new storage, route or
  protocol operation is needed; the part is already persisted as message content.
- **Schema subset, not full JSON Schema.** `schema` is a flat `type: "object"` with at most 30 properties of
  type `string` (length bounds, optional multiline), `number`, `integer` (min/max), `boolean`, or a string
  `enum` (optional `enumNames`, at most 50). `required` and `default` are honoured. Display order is the optional top-level `order` array of property names, because message parts are stored as JSONB, which does not preserve object key order (found in browser verification); unlisted properties follow. Nesting, `$ref`,
  `pattern`, `format` other than multiline, unknown types, unsafe keys or any limit breach reject the whole
  form. Regular expressions from agents are excluded to rule out ReDoS.
- **Safe rendering.** Fields come from a closed set of console components. Every agent string renders as text
  through React; nothing is evaluated or injected as markup.
- **Submission.** The console validates and coerces values to the declared types, keeps only declared keys,
  and sends them as an `application/json` data part through the normal send path. The user's authorization,
  skill routing, idempotency and audit are therefore the same as for a typed reply. The agent still owns
  validation of what it receives.
- **Start-of-task form.** The same extension entry in the agent card may carry `params.startForm`, a form definition of the
  same shape. When it advertises the extension and the definition validates, the chat page offers it for a new task; the
  submission starts a task with one `application/json` data part. The composer stays available beside it.
- **Fallback.** A missing extension, wrong media type, malformed or unsupported schema, an already-answered
  message or a task that is no longer waiting leaves the part as ordinary data and the composer available.
  The form is an addition to the composer, never a replacement.

## Consequences

- Forms with nesting, conditional fields or rich validation need a new extension version, not silent
  interpretation of unknown schema.
- Input forms (6.1) and start-of-task forms (6.4) are in the chat view. Forms on the approval review page (6.5) reuse the same
  parser and renderer as the `send_data` action of ADR 0015.
- Vitest gains a `vitest.config.ts` with the `@` path alias so component tests can import application modules.
