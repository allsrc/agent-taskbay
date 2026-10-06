# Rich content

> For readers who want to know how Taskbay shows what agents send (text, data, files, forms, generated interfaces), and the firm rule behind all of it: agent content is data, never code.

Agents send messages and artifacts made of parts: text, structured data, files, or URLs. Taskbay renders them with a fixed set of its own components. It does not run anything an agent supplies.

## The rule

- Agent text is shown as text through React. It is not interpreted as HTML.
- Markdown is rendered with GitHub-flavored Markdown. Markdown images are not loaded (a placeholder is shown instead).
- No script, HTML document or SVG from an agent is evaluated or embedded.
- Remote URLs in parts are not loaded, followed or opened automatically. The renderer only loads local artifact URLs of the form `/api/artifacts/<64 hex digest>`.
- Files are stored by the server and served as attachments (`Content-Disposition: attachment`, `application/octet-stream`, `nosniff`, `no-store`, and a `default-src 'none'; sandbox` CSP). A user can download one only if they can currently read a task that references that digest. Agent-supplied URLs or metadata cannot grant access to a file.

## How parts are rendered

| Part | Rendering |
| --- | --- |
| `text/plain` | Plain text, whitespace kept |
| `text/markdown`, or text that looks like Markdown | Markdown (GFM tables, lists, code). Remote images omitted |
| `application/json` and other JSON | Table when it is a list of objects, otherwise a collapsible tree. A "Structured" toggle is available |
| CSV | Table |
| Images, audio, video, PDF | Shown inline only when the bytes were archived by the server. Remote media URLs are not loaded |
| Anything else | A download card |

Each part shows its media type and a view switcher. A "Raw" view appears only where the screen enables it. An "Experimental" rich-JSON view exists in the component code, but no current screen switches it on, so you will not see it.

Inline binary parts are archived by the server when the event is ingested, and the rendered part points to that local copy. The server does not fetch remote URLs that an agent names, and your browser does not either. The original protocol JSON is archived by digest.

## Composing messages

The composer sends `text/plain`, `text/markdown` or `application/json` parts, and file attachments. Your input is checked against the input modes the agent advertises. The generic composer is always available, and none of the richer features below replace it.

## Structured forms

When an agent needs several typed values, it can send a form instead of free text. This is opt-in. The agent's card must advertise `https://extensions.allsrc.dev/agent-taskbay/structured-form/v1`. The form arrives as a data part with media type `application/vnd.agent-taskbay.form+json` in the `INPUT_REQUIRED` message.

The schema is a deliberately small subset, not full JSON Schema:

- A flat object with at most 30 properties.
- Property types: string (length bounds, optional multiline), number, integer (min and max), boolean, or a string enum (at most 50 options, optional display names).
- `required`, `default` and a top-level `order` array are honored.
- Nesting, `$ref`, `pattern`, other formats and unknown types reject the whole form. Regular expressions from agents are excluded to avoid denial-of-service patterns.

Fields are drawn by console components. The console validates and coerces what the person enters, keeps only declared keys, and sends them as one `application/json` data part through the normal send path, so permissions, skill routing, idempotency and audit are the same as for a typed reply. The agent still owns validation of what it receives.

The same extension entry may carry `params.startForm`, which the chat page offers when starting a new task. If anything is wrong (no extension, wrong media type, unsupported schema, already answered, task no longer waiting), the part stays ordinary data and the composer stays available.

Forms are also used inside approvals, where the form is pinned and only the values can be edited. See [Human in the loop](human-in-the-loop.md). Format details: [structured-form extension](../reference/extensions/structured-form.md).

## A2UI (generated interfaces)

[A2UI](https://a2ui.org) is a format in which an agent describes a small interface as JSON and the client draws it with its own components. Taskbay supports a subset of the v0.9 Basic Catalog, again only for agents that advertise the A2UI extension (`https://a2ui.org/a2a-extension/a2ui/v0.9`). Messages to those agents declare that only the Basic Catalog is supported.

- **Rendered components:** Text, Row, Column, Card, Divider, Button, TextField, CheckBox, ChoicePicker. Others appear as inert labeled placeholders.
- **Not rendered or run:** Image, Video, AudioPlayer and `openUrl` (nothing loads a URL), function calls, `checks` and `validationRegexp`. A surface in a different catalog shows a "catalog not rendered" notice.
- **Limits:** 200 components per surface, 8 surfaces, 64 KB data model, 5,000 characters per text, 50 options, nesting depth 20. Pointers naming `__proto__`, `constructor` or `prototype` are rejected.
- **Tolerant processing:** an invalid message is skipped and counted. The rest still apply.
- **Input stays local** until the person presses a Button. The button's action goes back as one `application/a2ui+json` data part on the same task, through the ordinary send path. So it is an `operate` command with the same checks as a typed reply. Buttons are disabled once the task is finished.
- **A surface is a request for input, never an approval.** Approvals use the decision flow.

A2UI renders in the chat view only. See [A2UI reference](../reference/a2ui.md) and the open limits in [#22](https://github.com/allsrc/agent-taskbay/issues/22) to [#25](https://github.com/allsrc/agent-taskbay/issues/25).

## AG-UI adapter

[AG-UI](https://docs.ag-ui.com) is a protocol that agent UI runtimes such as CopilotKit speak. Taskbay can expose an A2A agent to such a client at `POST /api/agents/{agentId}/ag-ui`. It is off by default (`A2A_AGUI_ENABLED=true` turns it on, otherwise the route answers 404).

The point of the adapter is that nothing about durability changes. A run is one durable command, accepted the same way as the command API, with the same grants, rate limit and same-origin check. The stream is translated from committed task state. A dropped client leaves the task running, and repeating a `runId` is idempotent. Mapping in short:

- `threadId` becomes the A2A `contextId`. The last user message's text becomes the A2A message.
- Agent text becomes text-message events. Other parts and artifacts become `CUSTOM` events. Each state change emits a `STATE_SNAPSHOT`.
- `COMPLETED` finishes the run. `CANCELED` finishes with outcome `cancelled`. `FAILED` or `REJECTED` become `RUN_ERROR`. `INPUT_REQUIRED` or `AUTH_REQUIRED` become an interrupt, whose `responseSchema` is the form's schema when a valid form was sent.
- A resume must answer exactly one open interrupt (`answered` sends the payload, `abandoned` cancels the task).
- A run streams for at most about 50 seconds. If the task is still working, the run ends with `RUN_ERROR` code `run_timeout`. The task continues, and its ID is in the last snapshot.
- An AG-UI interrupt answer is a reply, not an approval decision.

Frontend `tools`, `context`, `state` and `forwardedProps` are ignored. Non-text content is rejected. Cross-origin browser clients are refused. Skill-scoped users cannot use it for existing contexts. Details and issue links: [AG-UI reference](../reference/ag-ui.md).

## What is never executed or loaded

- Agent HTML, JavaScript or SVG.
- Regular expressions from agents (form `pattern`, A2UI `validationRegexp`).
- Remote images, audio, video, iframes and downloads.
- Function calls and `openUrl` in A2UI.
- Credentials from message content.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| A form shows as JSON data | Agent card does not advertise the extension, the media type is wrong, the schema is outside the subset, or the request was already answered | Check the card, and see [structured-form extension](../reference/extensions/structured-form.md) |
| "n invalid interface updates ignored" | Some A2UI messages failed validation | Fix the agent's output |
| Placeholder instead of a component | Component is not in the allowlist | Use a supported component |
| "Remote image omitted" | Agent sent a remote image URL | Send the bytes as a file part so the server can archive it |
| Chat composer is disabled | The agent's card is still being fetched. Extensions depend on it | Wait, or check agent health |

## Limits

- Rich content support is a closed list in code. A new component or form feature is a code change and a new extension version, not something the console infers.
- A2UI and forms are not rendered on task or approval pages (forms are rendered in approvals).
- Rendering is tested in unit tests and HTTP scenarios. Verification against third-party real-world agents is open ([#13](https://github.com/allsrc/agent-taskbay/issues/13), [#25](https://github.com/allsrc/agent-taskbay/issues/25)).

## Further reading

- [Decision record: A2UI renderer from an allowlisted subset](../archive/adr/0022-a2ui-renderer.md)

## Related

- [Build an agent for Taskbay](../guides/build-an-agent-for-taskbay.md)
- [Extensions index](../reference/extensions/README.md)
- [Human in the loop](human-in-the-loop.md)
- [Threat model](../security/threat-model.md)
