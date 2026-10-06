# Structured form extension (v1)

URI: `https://extensions.allsrc.dev/agent-taskbay/structured-form/v1`

An agent that advertises this extension can ask for typed input instead of free text. The console renders the form from a closed set
of components; nothing the agent sends is evaluated or injected as markup.

## Input request

In the `INPUT_REQUIRED` status message, include a data part with media type `application/vnd.agent-taskbay.form+json`:

```json
{
  "title": "Deployment details",
  "description": "Tell me where to deploy.",
  "submitLabel": "Deploy",
  "schema": {
    "type": "object",
    "required": ["environment"],
    "order": ["environment", "replicas"],
    "properties": {
      "environment": { "type": "string", "enum": ["staging", "production"], "enumNames": ["Staging", "Production"] },
      "replicas": { "type": "integer", "minimum": 1, "maximum": 10, "default": 2 }
    }
  }
}
```

`title`, `description` and `submitLabel` are optional.

## Schema subset

`schema` is a flat `type: "object"` with at most 30 properties. Each property is one of:

- `string` with optional length bounds and optional multiline;
- `number`;
- `integer` with optional `minimum` and `maximum`;
- `boolean`;
- a string `enum` with optional `enumNames` and at most 50 values.

`required` and `default` are honored. Display order is the optional top-level `order` array of property names (message parts are stored
as JSON, which does not preserve key order); unlisted properties follow. Nesting, `$ref`, `pattern`, a `format` other than multiline,
unknown types, unsafe keys or any limit breach reject the whole form. Regular expressions from agents are excluded to rule out ReDoS.

## Submission

The console validates and coerces the values to the declared types, keeps only declared keys, and sends them as an `application/json`
data part through the normal send path. Authorization, skill routing, idempotency and audit are the same as for a typed reply. The
agent still validates what it receives.

## Start-of-task form

The extension entry in the Agent Card may carry `params.startForm`, a form definition of the same shape. When the agent advertises the
extension and the definition validates, the console offers the form for a new task; submitting it starts a task with one
`application/json` data part. The composer stays available beside it.

## Fallback

A missing extension, a different media type, a malformed or unsupported schema, an already-answered message, or a task that is no
longer waiting leaves the part as ordinary data and the composer available. The form never replaces the composer.
