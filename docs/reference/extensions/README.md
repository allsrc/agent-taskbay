# Extensions reference

> For agent authors and operators: the A2A extensions Agent Taskbay defines or understands, how an agent opts in, and what happens when it does not.

Agent Taskbay defines three optional [A2A extensions](https://a2a-protocol.org/) of its own, understands one external extension (A2UI), and decodes
two sideband event formats. All are opt-in per agent. None is required to use the console: an agent that advertises nothing still works as a plain
A2A agent, and the console shows what it sends as ordinary messages and data.

These extensions are young. They are specified by this repository only; they have not been proposed to or accepted by the A2A project
([#19](https://github.com/allsrc/agent-taskbay/issues/19) tracks proposing them), and a formal plugin contract for extensions is not done
([#26](https://github.com/allsrc/agent-taskbay/issues/26)). Expect changes; URIs ending `/v1` are not guaranteed stable until a release says so.

## The extensions

| Extension | URI | Direction | What it does | Page |
| --- | --- | --- | --- | --- |
| Structured form | `https://extensions.allsrc.dev/agent-taskbay/structured-form/v1` | Agent to console and back | Ask for typed input, or offer a start-of-task form | [structured-form.md](structured-form.md) |
| Approval request | `https://extensions.allsrc.dev/agent-taskbay/approval-request/v1` | Agent to console | Ask a reviewer to approve one exact action | [approval-request.md](approval-request.md) |
| Skill routing | `https://extensions.allsrc.dev/agent-taskbay/skill-routing/v1` | Console to agent | Restrict a send to one skill so a skill-scoped grant means something | [skill-routing.md](skill-routing.md) |
| A2UI (external) | `https://a2ui.org/a2a-extension/a2ui/v0.9` | Both | Render agent-described interface surfaces from a safe subset | [a2ui.md](../a2ui.md) |
| Sideband events | `urn:agent-observability:sideband-events:v1` | Agent to console | Progress and trace events shown beside the task | [below](#sideband-events) |
| a2a-wrapper trace | `urn:x-a2a:trace:v1` | Agent to console | Trace artifacts mapped to the same sideband events | [below](#sideband-events) |

The `urn:` URIs are built into the code. The project's own extension URIs use the domain `extensions.allsrc.dev` and are identifiers only; nothing is fetched from them.
The identifier prefix may change when wire identifiers are renamed ([#27](https://github.com/allsrc/agent-taskbay/issues/27)). Treat a URI as immutable: an
incompatible change is published as a new version suffix, never by editing `/v1`.

## How an agent opts in

1. **Advertise the URI** in the Agent Card under `capabilities.extensions`:

   ```json
   {
     "capabilities": {
       "streaming": true,
       "extensions": [
         { "uri": "https://extensions.allsrc.dev/agent-taskbay/structured-form/v1", "required": false }
       ]
     }
   }
   ```

2. **Send content in the agreed shape.** For structured forms and approval requests that is a data part with a specific media type inside the status
   message of an `INPUT_REQUIRED` task. See each page.

You can try all of this without writing an agent: `npx agent-taskbay demo-agent` serves cards that advertise these extensions. See
[Build an agent for Taskbay](../../guides/build-an-agent-for-taskbay.md).

## Negotiation rules

These hold for every extension on this page unless its own page says otherwise.

| Rule | Behavior |
| --- | --- |
| Opt-in by card | Content is interpreted only if the agent's Agent Card advertises the extension URI. A part with the right media type from an agent that did not advertise it stays an ordinary data part. |
| Stored card, not live | Agent Taskbay reads the agent's most recent **stored card snapshot**. A snapshot is stored when the card is discovered through `GET /api/agents` or `GET /api/agents/{agentId}` (the catalog and agent pages do this). `POST /api/agents` only registers the URL and does not store one. If extension behavior is missing right after registration, load the catalog once. A card change takes effect at the next discovery. |
| Failure is quiet | Malformed or over-limit content is not an error. It stays ordinary message content and the normal composer remains available. |
| Never executed | Nothing an agent sends is evaluated, and no agent-supplied string is rendered as markup or a URL that the console loads. |
| Authorization is unchanged | Anything the console sends back (a form submission, an approved action, an A2UI action) goes through the normal command path: same role and grant checks, rate limits, idempotency and audit as a typed reply. |
| `required` flag | The card's `required` field is not interpreted. Not verified beyond the absence of any code that reads it. |
| Unknown extensions | Extensions that the console does not know are ignored. |

### What is sent to the agent

Extension URIs go to the agent in the message's `extensions` field. They come from three sources, merged and de-duplicated:

- URIs the caller lists in `config.extensions` on a send ([HTTP API](../http-api.md#command-body)), including those switched on in the console's Settings page ("Extension URIs activated on every request").
- **Sideband URIs the agent advertises and Agent Taskbay understands.** The understood set is the two built-in `urn:` URIs plus anything in `A2A_SIDEBAND_EXTENSION_URIS`
  ([Configuration](../configuration.md#catalog-and-extensions)). These are also sent in the A2A extensions request header.
- The skill-routing URI when a send is restricted to a skill, and the A2UI URI when the console sends to an agent that advertises A2UI.

The structured-form and approval-request extensions are content conventions detected on the agent's replies; the console does not need to list them on requests.

## Sideband events

Sideband events are optional progress or trace records that an agent attaches to its responses. They are delivered on the `sideband` event of the
[stream route](../http-api.md#post-apiagentsagentidstream), decoded from the stored task events as they are streamed. In this version no console screen
renders them (no component under `src/components` or `src/app` reads them), so today they are useful to API consumers only.

A payload becomes a sideband event only when it lives under a **negotiated** extension URI (advertised by the agent and understood by Agent Taskbay). Ordinary metadata is ignored.
Decoded sources:

- Message or status `metadata` entries keyed by the extension URI, or by `<uri>/events`, `<uri>/sideband`, or the conventional `sideband` and `sidebandEvents` keys.
- Artifacts whose `extensions` list names a negotiated URI. For `urn:x-a2a:trace:v1` the artifact's `metadata.traceType` (or its name) is mapped: `trace.lifecycle` to `agent.started`, `agent.finished` or `agent.error`;
  `trace.mcp.start` to `tool.started`; `trace.mcp` to `tool.completed`, `tool.declined` or `tool.failed`; `trace.thinking` and `trace.thought` to `agent.thinking` (debug level); `trace.decision` to
  `agent.decision`; `trace.delegation` to `agent.delegation`. Other trace types pass through with a generated title.

Each event has an id, timestamp, extension URI, type, title, level (`debug`, `info`, `warning`, `error`), normalized parts, optional metadata and task references.
Duplicates (same URI, id and parts) are dropped.

## Limits

- Only extensions advertised in a stored card are honored; there is no way to force one on for an agent that does not advertise it, except by adding a URI to the request list (which only affects what is sent).
- No schema is published for sideband payloads beyond what the decoder accepts; unrecognized shapes become a generic event.
- No automated browser test suite covers structured forms ([#14](https://github.com/allsrc/agent-taskbay/issues/14)).

## Further reading

- [Decision record: structured input forms](../../archive/adr/0020-structured-input-forms.md)

## Related

- [Structured form](structured-form.md)
- [Approval request](approval-request.md)
- [Build an agent for Taskbay](../../guides/build-an-agent-for-taskbay.md)
- [Rich content](../../concepts/rich-content.md)
