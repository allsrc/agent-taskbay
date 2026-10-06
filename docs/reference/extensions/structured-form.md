# Structured form extension (v1)

> For agent authors: how to ask a person for typed input (or offer a start-of-task form) so the console renders real fields instead of a free-text box.

- **URI:** `https://extensions.allsrc.dev/agent-taskbay/structured-form/v1`
- **Media type of the form part:** `application/vnd.agent-taskbay.form+json`
- **Status:** defined by this project only; not an A2A standard. See the [extensions overview](README.md).

An agent that advertises this extension can put a form definition in its `INPUT_REQUIRED` message. The console renders it from a closed set of field
types, validates what the person enters, and sends the values back as one `application/json` data part. Nothing in the definition is evaluated or injected as markup.

## What you must supply, and what Agent Taskbay does

| The agent supplies | Agent Taskbay supplies |
| --- | --- |
| The URI in its card's `capabilities.extensions` | Rendering, labels and basic validation in the browser |
| A form definition inside the status message of an `INPUT_REQUIRED` task | Sending the typed values back through the normal send path |
| **Its own validation of what it receives** | Authorization, rate limits, idempotency and audit for the reply |

The console validates in the browser. The server does **not** re-check a typed reply against your form, so treat the submission as untrusted input like any other message.
(Approval requests that carry a form are different: the server validates those; see [Approval request](approval-request.md).)

## Input request

Include a data part with the form media type in the agent's `INPUT_REQUIRED` status message. In A2A v1 JSON a data part looks like this:

```json
{
  "data": {
    "title": "Deployment details",
    "description": "Tell me where to deploy.",
    "submitLabel": "Deploy",
    "order": ["environment", "replicas"],
    "schema": {
      "type": "object",
      "required": ["environment"],
      "properties": {
        "environment": { "type": "string", "enum": ["staging", "production"], "enumNames": ["Staging", "Production"] },
        "replicas": { "type": "integer", "minimum": 1, "maximum": 10, "default": 2 }
      }
    }
  },
  "mediaType": "application/vnd.agent-taskbay.form+json"
}
```

Top-level fields of the definition:

| Field | Required | Limit | Notes |
| --- | --- | --- | --- |
| `schema` | yes | | An object with `type: "object"` and a `properties` object holding 1 to 30 entries. |
| `title` | no | 120 characters | Default `Agent request`. |
| `description` | no | 2,000 characters | |
| `submitLabel` | no | 40 characters | Default `Submit`. |
| `order` | no | | Array of property names. Listed properties come first, in that order; the rest follow. Message parts are stored as JSON, which does not keep key order, so ordering must be explicit. Note `order` is a sibling of `schema`, not inside it. |

The agent's text part in the same message is shown as the prompt. Only the **last** agent question of a task that is still waiting is rendered as a form;
an earlier or answered form is shown as plain data.

## Field types

Each key in `properties` is a field. Keys must match `^[A-Za-z_][A-Za-z0-9_]{0,63}$` and must not be `__proto__`, `constructor`, `prototype` or another `Object.prototype` member name
(`toString`, `valueOf`, `hasOwnProperty`, and so on). Common to all fields: `title` (label, up to 120 characters, defaults to the key), `description` (up to 2,000 characters),
`default`, and membership in the schema's `required` array.

| Field kind | Declared as | Options | Rendering and validation |
| --- | --- | --- | --- |
| Text | `"type": "string"` | `minLength`, `maxLength` (capped at 10,000), `format: "multiline"` | Multi-line when `format` is `multiline` or `maxLength` is over 200. Validated against the length bounds; the hard limit is 10,000 characters. |
| Number | `"type": "number"` | `minimum`, `maximum` | Any finite number. |
| Integer | `"type": "integer"` | `minimum`, `maximum` | Whole numbers only. |
| Yes/no | `"type": "boolean"` | `default` | Never required and always submitted: `false` when untouched. |
| Choice | `"enum": [ "a", "b" ]` (strings) | `enumNames` | 1 to 50 values, all strings. Labels come from `enumNames` only when it is an array of the same length; otherwise the values are used. A `default` must be one of the values. A property with `enum` is a choice regardless of `type`. |

## What is rejected

If **any** field is outside the supported subset the **whole form** is rejected and the message stays ordinary data with the composer available. Rejected:

- no `schema`, `schema.type` other than `object`, missing or empty `properties`, or more than 30 properties;
- a property that is not an object, whose key is invalid or reserved, whose `type` is anything other than `string`, `number`, `integer` or `boolean` (so `object`, `array`, `null`, and a missing `type` such as a `$ref` or `oneOf`);
- an `enum` that is empty, longer than 50 or contains a non-string.

Other keywords are **ignored, not rejected**. This differs from what older notes say: `pattern`, `format` values other than `multiline`, and unknown top-level or per-field keys have no effect and do not invalidate the form. Do not rely on `pattern` being enforced. (Agent Taskbay deliberately does not accept
regular expressions from agents, to rule out denial of service through pathological patterns.)

Anything the console does not enforce, your agent must.

## Submission

When the person submits, the browser validates and coerces the values to the declared types and **keeps only declared keys**. Validation messages: `Required`, `At least N characters`,
`At most N characters`, `Enter a number`, `Enter a whole number`, `At least N`, `At most N`, `Choose one of the options`. The values are sent as one data part:

```json
{ "data": { "environment": "staging", "replicas": 2 }, "mediaType": "application/json" }
```

It goes through the same `POST` command route as a typed reply, so it needs the `operate` permission on the agent and is recorded in the audit trail. Observed with the repository's fixture agent: answering its deploy form with `{"environment":"staging","replicas":2}` (sent through the AG-UI resume path, which uses the same command route) moved the task to `COMPLETED`.

## Start-of-task form

The agent can also offer a form for **new** tasks. Put a form definition (same shape as above) under `params.startForm` of the extension entry in the card:

```json
{
  "capabilities": {
    "extensions": [
      {
        "uri": "https://extensions.allsrc.dev/agent-taskbay/structured-form/v1",
        "params": { "startForm": { "title": "New deployment task", "submitLabel": "Start task", "schema": { "type": "object", "properties": { "service": { "type": "string" } } } } }
      }
    ]
  }
}
```

When the agent advertises the extension and the definition validates, the chat screen shows "Start with a form" for a new task. Submitting it starts a task whose first message is one
`application/json` data part. The free-text composer stays available beside it.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| The form shows as raw JSON data | The card does not advertise the URI, the stored card is stale (load the catalog to refresh it), the media type differs, the definition is outside the subset, or the message was already answered or is not the latest | Advertise the URI; check the media type string exactly; simplify the schema; check each rule above |
| Only some fields appear | Not possible: any invalid field rejects the whole form | Fix the offending field |
| A `pattern` is not enforced | Patterns are ignored by design | Validate in the agent |
| The start form does not show | `params.startForm` missing or invalid, or the extension is not advertised | As above |

## Limits

- Flat objects only: no nesting, arrays, file upload, date pickers, conditional fields, or regular-expression validation.
- No server-side validation of typed replies.
- A form is the agent's request for input, not an approval. Use the [approval request](approval-request.md) extension when a person must authorize an action.
- Browser behavior is verified manually and by unit tests; an automated end-to-end suite is not committed ([#14](https://github.com/allsrc/agent-taskbay/issues/14)).
- Over AG-UI, the schema is passed as an interrupt `responseSchema` ([AG-UI adapter](../ag-ui.md)).

## Related

- [Extensions overview and negotiation rules](README.md)
- [Approval request](approval-request.md)
- [Build an agent for Taskbay](../../guides/build-an-agent-for-taskbay.md)
- [Rich content](../../concepts/rich-content.md)
