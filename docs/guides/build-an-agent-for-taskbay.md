# Build an agent for Taskbay

> Who this is for: an author of an A2A agent who wants people to answer it through Agent Taskbay: with a typed form, an A2UI surface, or an approval step. At the end you know which extensions to advertise, what to send, what comes back, and how the reference fixture does it.

Any A2A agent works with Agent Taskbay as a plain chat target. Everything in this guide is optional. An agent opts in to richer behavior by listing an extension URI in its Agent Card. If the card does not list it, the console treats the content as ordinary data and shows it as such.

## Before you start

- An agent that serves an A2A Agent Card and a JSON-RPC or HTTP+JSON interface. The console does not use gRPC.
- A running console to test against ([Quickstart](../quickstart.md)).
- All the interaction in this guide happens in the **input-required** state: your agent moves the task to `TASK_STATE_INPUT_REQUIRED` and puts a special data part in the status message. The task then waits for a person.

What the console supplies: rendering, validation of what the person types, authorization, audit, idempotent delivery of the answer. What your agent must supply: a card that advertises the extension, a well-formed part, and its own validation of whatever comes back. The console never trusts the agent's markup and never assumes the agent validates input.

## The extensions

| Extension | URI | Use it to |
| --- | --- | --- |
| Structured form | `https://extensions.allsrc.dev/agent-taskbay/structured-form/v1` | Ask for typed input; optionally offer a start-of-task form |
| Approval request | `https://extensions.allsrc.dev/agent-taskbay/approval-request/v1` | Ask a reviewer to approve an exact action |
| Skill routing | `https://extensions.allsrc.dev/agent-taskbay/skill-routing/v1` | Let administrators grant access to one skill |
| A2UI v0.9 | `https://a2ui.org/a2a-extension/a2ui/v0.9` | Show a small declarative interface |

The first three are defined by this project. A2UI is a third-party specification. Field-level references: [extensions](../reference/extensions/README.md), [A2UI subset](../reference/a2ui.md).

Advertise them in the card under `capabilities.extensions`:

```json
{
  "capabilities": {
    "streaming": true,
    "extensions": [
      { "uri": "https://extensions.allsrc.dev/agent-taskbay/structured-form/v1", "required": false },
      { "uri": "https://extensions.allsrc.dev/agent-taskbay/approval-request/v1", "required": false }
    ]
  }
}
```

## Ask for a form

In the `INPUT_REQUIRED` status message, add a data part with media type `application/vnd.agent-taskbay.form+json`. This is the form the fixture sends (shortened):

```json
{
  "parts": [
    { "text": "Where should I deploy?" },
    {
      "mediaType": "application/vnd.agent-taskbay.form+json",
      "data": {
        "title": "Deploy request",
        "submitLabel": "Request deploy",
        "order": ["environment", "replicas", "note", "dryRun"],
        "schema": {
          "type": "object",
          "required": ["environment", "replicas"],
          "properties": {
            "environment": { "type": "string", "title": "Environment", "enum": ["staging", "production"], "enumNames": ["Staging", "Production"] },
            "replicas": { "type": "integer", "title": "Replicas", "minimum": 1, "maximum": 10, "default": 2 },
            "note": { "type": "string", "title": "Note", "maxLength": 200 },
            "dryRun": { "type": "boolean", "title": "Dry run" }
          }
        }
      }
    }
  ]
}
```

Rules the console enforces:

- `schema` must be a flat `type: "object"` with 1 to 30 properties. Property names match `^[A-Za-z_][A-Za-z0-9_]{0,63}$` and may not be names such as `__proto__` or `constructor`.
- Each property is a `string` (optional `minLength`, `maxLength`, `format: "multiline"`), a `number`, an `integer` (optional `minimum`, `maximum`), a `boolean`, or a string `enum` of at most 50 values (optional `enumNames`).
- `order` sits next to `schema`, not inside it. It lists property names in display order, because stored JSON does not keep key order. Properties not listed come last.
- A nested object, an unknown type, or more than 30 properties rejects the whole form, and the part is shown as ordinary data.
- The person can only use the form while the task is still waiting. The composer stays available next to the form.

The reply is a normal send on the same task, with one `application/json` data part holding only the declared keys, coerced to the declared types. In the fixture the reply data is read as `{ environment, replicas, ... }`. The console validates before sending; **validate again**.

### Offer a start-of-task form

Put a form definition in the extension entry's `params.startForm` (same shape as above). The console then offers it when someone starts a new task with your agent, and sends the submission as the first message with one `application/json` data part. The `form` and `showcase` fixture variants do this with a "New deployment task" form.

## Ask for approval

An approval is for actions where a human must say yes to specific content. In the `INPUT_REQUIRED` status message, add a data part with media type `application/vnd.agent-taskbay.approval-request+json`:

```json
{
  "title": "Delete the staging cluster",
  "summary": "Agent asks: please approve the deploy",
  "risk": "high",
  "expiresInSeconds": 3600,
  "action": { "kind": "send_message", "text": "Yes, please approve the deploy" }
}
```

| Field | Rule |
| --- | --- |
| `title` | Required, 1 to 300 characters. |
| `summary` | Optional, up to 4000 characters. |
| `risk` | `low`, `medium` or `high`. Default `medium`. |
| `expiresInSeconds` | Optional. Clamped to 5 minutes through 7 days. Default 24 hours. |
| `action` | `{ "kind": "send_message", "text": "...", "data": {...}? }` (text up to 20,000 characters), or `{ "kind": "send_data", "form": {...}, "values": {...} }` where `form` is a valid form definition from the previous section and `values` are valid for it. |

The whole part may not exceed 128 KiB. A malformed part is ignored and the message stays ordinary content.

What happens next:

- The console opens a pending approval for the task. Only the **latest** `INPUT_REQUIRED` message can open one. A changed request replaces the open one (one live approval per task). Re-sending the identical request opens nothing new.
- The agent cannot decide. Reviewers see the exact action, approve, reject, edit or send it back (see [Approvals and ownership](approvals-and-ownership.md)). The request cannot name an assignee or policy: such fields are not read.
- On approval the console sends the approved content as a reply on the same task, once. That message carries `metadata.approval`:

```json
{ "requestId": "...", "decisionId": "...", "revision": 1, "revisionDigest": "..." }
```

A cooperating agent should check the digest matches what it asked for and echo it in its result. The fixture echoes `revisionDigest` in its completion text. If a reviewer edits the action, the approved content and digest are the edited ones, with a higher `revision`.

If the task finishes or expires first, the approval becomes `superseded` or `expired` and nothing is sent.

Do not treat an A2UI surface or a form as an approval: they only collect input. An approval is a separate record with a decision and an audit trail.

## Show an A2UI surface

If the card advertises `https://a2ui.org/a2a-extension/a2ui/v0.9`, an `INPUT_REQUIRED` message may carry a data part with media type `application/a2ui+json` whose `data` is an array of A2UI v0.9 envelopes (`createSurface`, `updateComponents`, `updateDataModel`). The console renders a closed set of components (Text, Row, Column, Card, Divider, Button, TextField, CheckBox, ChoicePicker) as inert React elements; other components appear as labelled placeholders. It loads no URLs and runs no functions: images, videos and `openUrl` are not rendered or run, and agent strings are shown as text, not HTML or Markdown. A button with an `action.event` sends back one data part of media type `application/a2ui+json` containing an `action` object (the fixture reads `data.action.context`).

The `showcase` and `a2ui` fixture variants include a surface with hostile content (HTML in text, a phishing link, an external image) to show what is not rendered. Limits and exact behavior: [A2UI reference](../reference/a2ui.md). The A2UI decision record describes the renderer as chat-only when it was written; I did not re-check the task and approval pages. Open issues are linked from [Compatibility](../reference/compatibility.md).

## Skill routing

An advertised skill is descriptive; the console cannot assume your agent confines itself to it. If you advertise the skill-routing extension, the console sets request metadata under that URI to `{ "skillId": "<id>" }` on sends restricted to one skill. Your agent must enforce the route, reject unsupported skills, and keep the new context inside the skill. Without this extension administrators can only grant whole-agent access. Only enable it for an agent you trust to honor it: grants cannot constrain an agent's internal behavior.

## Walkthrough: the fixture agent

`scripts/fixture-form-agent.mjs` is the reference. It is a test fixture, not product code: a single HTTP server that serves `GET /<variant>/card.json` and answers `SendMessage` and `SendStreamingMessage` on `/<variant>/a2a`.

```bash
node scripts/fixture-form-agent.mjs 4010
```

It prints these Agent Card URLs:

```text
http://127.0.0.1:4010/form/card.json
http://127.0.0.1:4010/plain/card.json
http://127.0.0.1:4010/invalid/card.json
```

The server also serves `showcase`, `approver`, `a2ui`, `rogue` and `unknown` variants. The packaged `demo-agent` command lists `showcase`, `form`, `approver` and `a2ui`.

| Variant | Advertises | Behavior to look for |
| --- | --- | --- |
| `form` | structured form, with a start-of-task form | New task form; replies with a deployment form; completes with "Deploying N replica(s) to ..." |
| `plain` | nothing | Sends the same form part; the console shows it as ordinary data |
| `invalid` | structured form | Sends a nested schema; the console rejects it and falls back to plain data |
| `approver` | approval request | A message with "structured" asks for a form-based approval; any other asks for a text approval; a message containing "invalid" sends a bad request that the console ignores |
| `rogue` | nothing | Sends an approval request anyway; the console ignores it |
| `a2ui` | A2UI v0.9 | Sends a surface, completes when it receives the action |
| `showcase` | form, A2UI, approval | Chooses by message: "surface" gives an A2UI surface, "approve" an approval request, anything else a form |
| `unknown` | only an unrecognised extension | Sends form, A2UI and approval parts anyway; none are treated as special |

The `plain`, `invalid`, `rogue` and `unknown` variants are the failure cases: they show what happens when an agent sends content it did not advertise or that is invalid. Use them to see the fallback before you ship.

Two practical notes from reading it:

- Every reply is an A2A task update: `TASK_STATE_WORKING`, then a final status event with `TASK_STATE_INPUT_REQUIRED` or `TASK_STATE_COMPLETED`. Over streaming the events arrive as server-sent events, one JSON-RPC response per `data:` line.
- The fixture's card sets `protocolVersion` `1.0` and `protocolBinding` `JSONRPC`.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| The form shows as raw JSON or a "data" block | The extension is not in `capabilities.extensions`, the media type differs, or the schema is outside the subset | Advertise the URI exactly as written, use the exact media type, flatten the schema |
| No approval opens | The extension is not advertised, the part is malformed, it is not on the latest `INPUT_REQUIRED` message, or the task is not in that state | Check the table of fields above. A reviewer can still use **Request approval** on the task |
| Approved content never reaches the agent | The execution is recorded as failed or "unknown", for example because the agent was unreachable | The approval page's Result card shows the delivery state. "Delivery outcome unknown" is never retried automatically. |
| A2UI surface is blank or has placeholders | Catalog other than the Basic Catalog, unsupported components, limits exceeded | See the [A2UI reference](../reference/a2ui.md) |
| The reply has unexpected values | You relied on the console's validation | Validate on receipt; the console only checks the declared schema |

## Limits

- The extension URIs are identifiers with `/v1` fixed. An incompatible change would be published under a new version, not by editing `/v1`.
- Pre-1.0: the extension definitions may still change between minor versions.
- Agents cannot assign reviewers, set policy, or approve anything themselves.
- I did not test third-party A2A agents. The fixture is the only agent I exercised.

## Further reading

- [Decision record: agent-originated approvals](../archive/adr/0023-agent-originated-approvals.md)

## Related

- [Approvals and ownership](approvals-and-ownership.md): what the reviewer sees and does.
- [Connect an agent](connect-an-agent.md): register it and give people access.
- [Extension reference](../reference/extensions/README.md)
- [A2UI reference](../reference/a2ui.md)
