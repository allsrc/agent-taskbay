# A2UI reference

> For agent authors: which parts of the A2UI interface format Agent Taskbay renders, what it refuses, and the safety rules that hold whatever an agent sends.

[A2UI](https://a2ui.org) lets an agent describe an interface as declarative JSON that the client renders with its own components. Agent Taskbay renders a small, fixed subset of A2UI **v0.9**
and treats everything else as inert. It is experimental: it has not been tested against a real third-party A2UI agent or the official schemas ([#25](https://github.com/allsrc/agent-taskbay/issues/25)); it
was exercised with the repository's own fixture agent and unit tests.

## Opt-in and detection

| Item | Value |
| --- | --- |
| Extension URI | `https://a2ui.org/a2a-extension/a2ui/v0.9` |
| Supported catalog | Basic Catalog, `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json` |
| Media types of the part | `application/a2ui+json` (v0.9.1) or `application/json+a2ui` (v0.9 documents). The type may also be declared as `metadata.mimeType` on the part. |
| Part shape | A **data** part whose `data` is an **array** of envelopes |

Surfaces render only for agents whose stored card advertises the extension URI ([negotiation rules](extensions/README.md#negotiation-rules)). Otherwise the part is shown as an ordinary data part.
For an agent that advertises it, every message the console sends activates the extension and includes this metadata so the agent can pick a catalog the console renders:

```json
{ "a2uiClientCapabilities": { "v0.9": { "supportedCatalogIds": ["https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"] } } }
```

The chat composer waits until the agent's card is known, because the card decides which extensions a message activates.

## Where surfaces appear

Surfaces are rendered in the **Chat** screen only. They are not shown on the task or approval pages and are not mapped to AG-UI ([#24](https://github.com/allsrc/agent-taskbay/issues/24)). A surface is the agent's
request for input, like an `INPUT_REQUIRED` question. It is **never an approval**; use the [approval request](extensions/approval-request.md) extension when a person must authorize an action.

## Server-to-client envelopes

Each array element is one envelope: an object with `version: "v0.9"` and exactly one of the keys below. Surfaces are built by folding **all** A2UI parts of the task's agent messages, oldest first.

| Envelope | Fields used | Rules |
| --- | --- | --- |
| `createSurface` | `surfaceId`, `catalogId` | `surfaceId` 1 to 128 characters; `catalogId` a string of at most 512. At most 8 surfaces; a ninth is rejected. A catalog other than the Basic Catalog creates a surface that shows "This agent chose a catalog this console does not render." and renders nothing from it. `theme` and `sendDataModel` are not read. |
| `updateComponents` | `surfaceId`, `components` | The surface must exist; `components` is a non-empty array of objects, each with an `id` (1 to 128 characters) and a `component` name (at most 64 characters). Components are merged by `id`. At most 200 components per surface. If any entry is invalid the **whole envelope** is rejected. The tree is rendered from the component with id `root`; without one the surface shows "Waiting for the agent…". |
| `updateDataModel` | `surfaceId`, `path`, `value` | `path` is an absolute RFC 6901 JSON Pointer (default `/`, at most 512 characters). At the root, `value` must be an object. The model may not exceed 64 KB. Pointers naming `__proto__`, `constructor` or `prototype` are rejected. A missing `value` deletes the path. |
| `deleteSurface` | `surfaceId` | Removes the surface. |

An invalid envelope is **skipped and counted**, and the rest of the array is still applied. The console shows "n invalid interface updates ignored." Unknown envelope types, a wrong `version`, extra
top-level keys and unknown surfaces count as invalid. At most 2,000 envelopes are processed per task.

## Components

Only these Basic Catalog components render. Anything else becomes a labelled inert placeholder (`Unsupported component "Name"`), as do missing children, unsupported child lists (templates), a missing
component, nesting deeper than 20 levels and cycles.

| Component | Properties honored | Notes |
| --- | --- | --- |
| `Text` | `text`, `variant` (`h1` to `h5`, `caption`, `body`) | Rendered as plain text (at most 5,000 characters); any other `variant` is `body`. No Markdown, no HTML. |
| `Row`, `Column` | `children` (array of component IDs), `justify`, `align` | `justify`: `start`, `center`, `end`, `spaceBetween`, `spaceAround`, `spaceEvenly`, `stretch`. `align`: `start`, `center`, `end`, `stretch`. A template object instead of an array is an unsupported-children placeholder. |
| `Card` | `child` | |
| `Divider` | `axis` | `vertical`, otherwise horizontal. |
| `Button` | `child`, `variant`, `action.event` | `variant` `primary` is emphasized, `borderless` is quiet, anything else is outlined. Enabled only while the task is not finished and the action is a valid `event`. A button whose action is a local `functionCall` is disabled with "This action is not supported". |
| `TextField` | `label`, `value`, `variant` | `variant`: `longText` (multi-line), `obscured` (password-type input), `number`, otherwise text; at most 5,000 characters. Editable only when `value` is a `{ "path": "/pointer" }` binding. |
| `CheckBox` | `label`, `value` | Editable only with a path binding; checked when the bound value is `true`. |
| `ChoicePicker` | `label`, `options`, `value`, `variant` | Up to 50 options of `{ value, label }`. `multipleSelection` renders checkboxes, anything else radio buttons. Editable only with a path binding; the bound value is an array of strings (or one string). |

Not rendered (inert placeholder): `Image`, `Icon`, `Video`, `AudioPlayer`, `List` and templates, `Tabs`, `Modal`, `DateTimeInput`, `Slider` ([#22](https://github.com/allsrc/agent-taskbay/issues/22)), and any
component outside the Basic Catalog.

### Values and bindings

A value is a literal string, number or boolean, or a binding `{ "path": "/absolute/pointer" }` with exactly one key. Relative paths, function calls, arrays and `null` resolve to nothing. Function calls,
`checks` and `validationRegexp` are **not evaluated** ([#23](https://github.com/allsrc/agent-taskbay/issues/23)): a regular expression from an agent is a denial-of-service risk.

The agent's data model is built only by `updateDataModel`. What the person types is kept as a separate overlay in the browser, so an agent update never erases it, and it is not sent anywhere until
a button action sends bound values.

## Actions: client to server

A `Button` with `action: { "event": { "name": "...", "context": { "key": <literal or binding> } } }` sends one message on the **same task**, carrying a data part of media type `application/a2ui+json`:

```json
{
  "version": "v0.9",
  "action": { "name": "confirm_deploy", "surfaceId": "main", "sourceComponentId": "confirm", "timestamp": "2026-10-06T20:00:00.000Z", "context": { "env": "staging" } }
}
```

`name` is 1 to 128 characters. Context values are resolved from the effective data model (agent model plus the person's edits) at click time; unresolvable values are omitted; the resolved context may not
exceed 16 KB, otherwise the button is disabled. The message goes through the normal command path, so it needs the `operate` permission and is rate limited, idempotent and audited like a typed reply.

## Safety rules

- Components are React elements chosen by the console. Every agent string is rendered as text; nothing is parsed as markup. (The fixture agent sends `<b>not bold</b><img src=x onerror=...>` as caption text to check this.)
- **No URL is loaded, followed or opened** by the renderer. Images, video, audio and `openUrl` are not implemented.
- No code, function or expression from an agent is evaluated.
- Prototype-polluting pointer segments are rejected.
- Sizes are bounded (see limits below), and a surface cannot grow without limit.
- The page's Content-Security-Policy additionally restricts `connect-src` to the same origin and forbids framing.

| Limit | Value |
| --- | --- |
| Components per surface | 200 |
| Nesting depth | 20 |
| Surfaces per task | 8 |
| Data model size | 64 KB |
| Text length | 5,000 characters |
| Choice options | 50 |
| Identifier length | 128 characters |
| Action context size | 16 KB |
| Envelopes processed per task | 2,000 |

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| The part appears as raw data | The card does not advertise the URI, the stored card is stale, the media type is not one of the two, `data` is not an array, or the task is not shown in Chat | Check each item in [Opt-in and detection](#opt-in-and-detection) |
| "Waiting for the agent..." | No component has the id `root` | Add a `root` component |
| "n invalid interface updates ignored" | An envelope failed validation | Check `version`, the single key, ids and limits |
| A control is greyed out | No path binding, an unsupported action, or the task finished | Bind `value` to a path; use `action.event` |
| Placeholder "Unsupported component" | Outside the supported list | Use a supported component |
| "catalog this console does not render" | `catalogId` is not the Basic Catalog | Use the Basic Catalog id |

## Limits

- A subset of the Basic Catalog: no media, lists, tabs, modals, date or slider inputs; no catalog functions or validation checks ([#22](https://github.com/allsrc/agent-taskbay/issues/22), [#23](https://github.com/allsrc/agent-taskbay/issues/23)).
- Chat screen only; no merge rule yet for an agent update that arrives after a person edited a field ([#24](https://github.com/allsrc/agent-taskbay/issues/24)).
- v0.9 only; no other A2UI versions or custom catalogs.
- Not verified against third-party A2UI agents or the official schemas ([#25](https://github.com/allsrc/agent-taskbay/issues/25)).

## Further reading

- [Decision record: A2UI renderer](../archive/adr/0022-a2ui-renderer.md)

## Related

- [Rich content](../concepts/rich-content.md)
- [Extensions overview](extensions/README.md)
- [Build an agent for Taskbay](../guides/build-an-agent-for-taskbay.md)
- [AG-UI adapter](ag-ui.md)
