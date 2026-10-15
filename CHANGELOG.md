# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [semantic versioning](https://semver.org/) once it reaches 1.0; until then minor versions may change interfaces.

## [Unreleased]

### Changed

- An Agent Card that marks an extension `required: true` which Taskbay does not support now blocks sending to that agent (`409`, `extension_required`) until an administrator allows it on the agent page or with `PATCH /api/agents/{agentId}/settings`. Canceling is not blocked. The override is audited. Schema version 4.
- Sending to, or canceling, a task that has already finished is refused with `409` and `task_terminal` instead of being forwarded to the agent. Start a new task in the same conversation.
- Failed sends and cancels now explain themselves in chat and on the task page: what the agent refused, whether it is safe to send again, and a **Start new task** action when the task has finished. Refused and uncertain commands carry their kind through the streaming route.
- Tasks started outside Taskbay can be found and taken over: `GET /api/agents/{agentId}/remote-tasks` lists an agent's tasks live (nothing is stored) and `POST …/remote-tasks/track` stores one and follows it, so it can be answered, steered, canceled and shown in the Inbox. Needs an administrator or a whole-agent `operate` grant. The console screens for this follow.
- `npx agent-taskbay demo-agent` serves an `automation` sample agent that already has tasks another system started, and the quickstart gains a second walk-through that browses, tracks and answers one.
- **Automatic task discovery** (opt-in): with `A2A_TASK_DISCOVERY=auto` an administrator can set an agent to **Automatic**, and the worker then stores tasks started elsewhere in the background, within limits (finished tasks from the last 7 days by default, 500 on the first sweep, 200 per later sweep, 5,000 per agent, then it pauses and says so). Schema version 5.
- Tasks that another system started are tagged **Discovered** in the Tasks list (with a **Discovered** filter) and in chat. The task page explains where it came from and who tracked it, and a conversation about one is named after the task. `GET /api/tasks` takes `origin`, and tasks carry `origin`, `discoveredAt` and (on the detail) `trackedBy`.
- The agent page has a **Task discovery** card: **Browse only** (the default) or **Off** per agent, set by an administrator, and the deployment cap `A2A_TASK_DISCOVERY` shown beside the modes it forbids. Connecting an agent now says that Taskbay can list its tasks with the agent's credentials. `GET /api/agents/{agentId}/discovery` reports the status.
- **Browse tasks** on the agent page opens a live list of the agent's tasks, with state and context filters, **Track** on each row and **Track by task ID**. Nothing is stored until a task is tracked.
- Notifications for tasks started outside Taskbay: a task a person tracked never notifies on first sight, and one found by automatic discovery notifies only when it is waiting on input within the last 24 hours. The title reads "A task started outside Taskbay needs input".
- A definite A2A error from an agent (task not found, task not cancelable, unsupported operation, unsupported content type, required extension, unsupported version, malformed request) now ends a command as `rejected` with an `errorKind`, instead of `uncertain`. A rejected command is safe to send again; the agent's own error text is not stored or returned. Schema version 3.
- Migrations are numbered (`Migration0001_Baseline`, …) instead of timestamped, and each release declares the schema version it needs. Startup messages and backup names say which schema version the database is at, and a database newer than the release is refused. The sixteen development-period migrations are squashed into one baseline. Databases that applied all of them are adopted unchanged; ones missing some are refused with instructions to start `agent-taskbay@0.2.0` once.
- On start, `npx agent-taskbay` and `npm run dev` say whether they are creating a new database or upgrading an existing one. An existing PGlite database is copied to `<dir>.backup-v<schema version>-<timestamp>` before it is upgraded (newest 3 kept), and nothing is printed when it is already current.
- Sent messages use a soft brand surface instead of the primary action color.
- Long content is folded with a **Show all N lines** toggle instead of stretching the conversation: messages and results after about 20 lines, progress steps, reasoning and JSON values after 6. Multi-line strings inside JSON keep their line breaks, JSON trees and tables page at 100 entries, and expanded data cards scroll inside a capped height. Code with commas is no longer offered as CSV.
- Text in chat can be viewed another way without changing stored data. Ordinary text carries no controls; text with another useful view gets a **Format as …** / **Plain text** toggle and a menu naming the declared type with Text, Markdown, valid JSON, CSV and Sanitized HTML. An agent's content that does not fit its declared media type is shown as what it is: Markdown or JSON sent as `text/plain`, JSON labelled `text/html` or `text/markdown`, Markdown labelled `application/json`; an HTML page labelled `text/markdown` becomes contained source, and `text/csv` prose stays text. HTML is opt-in: its source shows in a contained block, with **Preview HTML** opening a sanitized, styled document in an isolated iframe (dialog on desktop, sheet on phones), scripts and remote resources blocked.
- In chat, each run of messages now carries a label saying who is speaking ("You", or the agent's name with its avatar), so your messages are easy to tell apart from the agent's.
- In chat, explicitly tagged or tool-shaped calls and results (including Google ADK `function_call` and `function_response` parts) fold into one quiet **Activity** log, with each entry opening to its JSON. Generic JSON artifacts remain visible as results. Consecutive agent messages before the reply fold into **Progress**. A final message that only repeats a finished text result is no longer shown twice.
- For agents whose card advertises streaming, chat defaults `returnImmediately` on so Taskbay can subscribe to the active task and show updates sooner. The per-chat **Options** switch can turn it off.
- New chats select their conversation on the first committed task snapshot, keeping streamed updates visible while the task runs.
- Status updates fold into **Progress** while the agent works. Progress and Activity share one step design: text updates read as lines, and structured parts become one-line steps that open to their JSON. A step names its kind (tool call, result, code, code output, reasoning, error or data), the tool or best title, the call id and a short preview, recognizing Google ADK (including `tool_response`), OpenAI, Anthropic, LangChain / LangGraph, Vercel AI SDK and MCP shapes; a result carrying only a call id takes the call's name, and arbitrary JSON is summarized by its title, id and first fields instead of `[data]` or a bare media type. A sub-agent author (`adk_author`) is shown when it differs from the agent.

### Added

- **Cancel this task and related tasks** in task pages and chat lets you select tasks to cancel separately. Only the current task starts selected; **Cancel this and related** selects all eligible tasks. Each result appears separately, refusals do not stop other selections, and finished or non-operable tasks are disabled. Completed runs record `task.cancel.related` with counts only.

- Task pages show **Related tasks** in both directions (**References** and **Referenced by**) from user and agent messages’ `referenceTaskIds`. Links persist across restarts and projection rebuilds, resolve only within the same organization, agent and tenant, and reveal only tasks the reader may access. Schema version 8.

- Administrators can **Fetch** and **Refresh** an extended Agent Card using the stored agent credential. Extra skills appear as **Authenticated** for whole-agent readers; public skills, routing, grants and extension negotiation remain unchanged. Extended snapshots use schema version 7. Upgrade all instances before the first extended-card fetch.

- A message sent to a task that is working now shows what Taskbay can tell about it: **Delivered**, **Agent responded**, **Agent refused: …**, **Waiting for a response** (then **No response yet** after 60 seconds) or **Not sure it arrived**. `GET /api/tasks/{taskId}` returns it as `steering`, worked out when you read it; nothing new is stored. Taskbay does not claim the agent used the input.
- **Stop and restart with this** in chat cancels a running task and then starts a new task in the same conversation that references the old one, as two visible steps. The new task starts only after the old one is canceled, a failed step says what did and did not happen, and a repeat or reload does not create a second cancel or task.
- The push worker removes push configurations Taskbay left on agents for finished tasks (a crash mid-registration, or Taskbay down when the task ended). It deletes only configurations carrying a registration ID Taskbay issued or a URL under its own `/api/webhooks/a2a/` path, checks each task at most daily, and records `push.cleanup.<count>` in the security audit.
- **Load agent history** in chat asks the agent for the history it keeps for a task (`POST /api/tasks/{taskId}/history/refresh`, 1 to 200 messages, default 50, 6 a minute per task). Messages Taskbay did not already have appear under **History the agent returned**, apart from **What Taskbay received**, and messages carry `origin: "agent-history"`. Loading again adds nothing.
- The agent page has a **Connection** card (binding, interface, protocol version, tenant, and which extensions are negotiated, ignored or required but not supported), replacing **Interfaces**. When an agent's card lists several tenants, the chat options let you choose the tenant for a new conversation; Taskbay now sends and stores the effective tenant instead of an empty one. `GET /api/agents` entries gain a `connection` object.
- `GET /api/tasks` filters by `contextId`, `agentId` and `updatedAfter` (besides `origin`), pages with an opaque `after` cursor and returns `next`; `offset` still works. The Tasks list pages with the cursor. Schema version 6 adds an index for context lookups.
- A task's page shows **Other tasks in this context** (`contextSiblings` on `GET /api/tasks/{taskId}`), and the Tasks list can be narrowed to one context from there, with a removable **Context** chip.
- `A2A_TASK_DISCOVERY` (`off`, `browse` or `auto`, default `browse`), the highest task discovery mode any agent may use, and the stored fields behind it (an agent's discovery mode, where a task came from, who tracked it). Schema version 2.
- `scripts/fixture-scenario-agent.mjs`, a controllable sample agent for protocol scenarios (development only; not in the npm package).
- `scripts/fixture-content-agent.mjs`, a streaming sample agent that sends content under the wrong media type (cases in `scripts/fixtures/mislabeled-content.json`, shared by its tests) and, with `tools` and `long`, tool calls, results, reasoning and other JSON in common framework shapes, and 700-line content.

### Fixed


- Markdown in chat no longer turns bare addresses into links. A URL, `localhost:3000/…`, `www.example.com`, an email or a path mentioned in running text stays as written; only links the author wrote (`[label](url)`, `<url>`) are clickable, and they open in a new tab with `noopener noreferrer nofollow`.

- In chat, the newest message no longer runs into the composer. On desktop the message column was sized to the pane instead of its content, so the last message ended flush against the "Send to" area with its bottom padding lost; on phones and tablets the scroll-to-bottom ran too early and stopped short, leaving the last message, its quick replies or form under the composer and tab bar. The chat now follows new content as it lays out while you are at the bottom, pauses when you scroll up to read, and resumes when you send.
- In chat, a question the agent asks (input or authorization required) and its final reply stay in the conversation instead of being folded into the Progress log, so quick replies and forms show again.
- A status update's event metadata (such as Google ADK's `adk_author`) now reaches its message in stored task projections; before, only a direct projection kept it. Stored status messages also record the state they arrived with, so a working update followed by a result is not shown as the reply. Run `npm run db:projections:rebuild` to refresh tasks recorded earlier; they also refresh on their next event.

## [0.2.0] - 2026-10-14

A redesign of the console, with a new Home screen. No HTTP API, database schema or configuration changed, so there is nothing to migrate when upgrading from 0.1.x.

### Added

- **Home.** The console now opens on a Home screen: counts of agents reachable, items that need you, active tasks and unread notifications; the approvals and input requests waiting on you; recent conversations; and the connected agents. Before any agent is connected it shows a three-step get-started panel.
- **Phone navigation.** A bottom tab bar (Home, Chat, Inbox, Tasks and a More sheet for the rest) with a back button on detail screens. The Inbox tab shows the pending-approval count, and More shows a dot when there are unread notifications.
- **Version in the sidebar.** The running package version (for example `v0.2.0`) is shown under the tenant, whether you start from source or with `npx agent-taskbay`.
- **Progress log in chat.** The agent's in-between status updates fold into a Progress log that is open while the task runs and folded when it finishes. The agent's last message, any question it asks you and its artifacts stay in the main conversation, and an artifact shows as a highlighted Result card.
- New screenshots for the README and the console guide, including Home.

### Changed

- **New design system.** The whole console moved to the http2xx design system: new tokens, light and dark themes, Base UI components, and Geist and Space Grotesk type. Status colors are now tone-based pills ("Input required", "Completed") instead of upper-case codes.
- **Every screen rebuilt on shared layouts.** Tasks, Inbox, Approvals and Agents are list-and-detail screens; Chat, Orchestration, Notifications, Audit and Settings are full pages. The layout is responsive: a sidebar on large screens, an icon rail on medium screens, and the tab bar on phones. Filter chips wrap on wide screens, and outline buttons have a clearer border.
- **Add agent dialog.** Redesigned as a three-step flow (Agent Card, Review, Connect) with a review card, and it opens as a bottom sheet on a phone.
- Forms an agent sends in chat use the design system's controls. Text-only actions across the console (for example "View the full trail", "Add an agent") are now real buttons.
- New logo mark, favicon and app icons from the http2xx brand suite.
- Dependencies: the Radix UI packages and `next-themes` are replaced by `@base-ui/react`, `cmdk` and `shadcn`.

### Fixed

- A long unbroken string in an agent message (for example an approval hash) made the chat page scroll sideways on a phone.

## [0.1.1] - 2026-10-07

Documentation and release-process release. No runtime behavior changed.

### Changed

- The README and documentation are rewritten around the questions a reader brings: a quickstart, concepts, task guides, reference pages
  (configuration, CLI, HTTP API, extensions, compatibility and known limitations), operations and troubleshooting, a threat model and an
  honest status page. The earlier planning documents are kept in `docs/archive/`.
- The README now leads with `npx agent-taskbay`, and states plainly what the project does not do.
- Releases are published from GitHub Actions with npm trusted publishing (OIDC) and provenance; no npm token is stored. The GitHub release
  notes are taken from this changelog.

## [0.1.0] - 2026-10-07

First release, published to npm. For what works today and what does not, see [`docs/project/status-and-roadmap.md`](docs/project/status-and-roadmap.md).

### Added

- `npx agent-taskbay`: a local launcher that starts the console with an embedded database, generated vault keys and a development
  administrator, bound to loopback only. `agent-taskbay demo-agent` serves sample A2A agents to connect ([decision record](docs/archive/adr/0025-npm-distribution-and-local-launcher.md)).
- `A2A_AUTO_MIGRATE`: apply pending migrations when the server starts. On by default for `next dev` with PGlite and for the launcher.
- Community files: contributing guide, code of conduct, security policy, issue and pull request templates, Dependabot, and a release
  workflow that publishes to npm with provenance.
- [`docs/archive/deployment/PRODUCTION_TOPOLOGY.md`](docs/archive/deployment/PRODUCTION_TOPOLOGY.md): the intended production topology and artifact-storage options.
- [ADR 0026](docs/archive/adr/0026-taskbay-client-sdk.md) records the parked proposal for a Taskbay client SDK ([#31](https://github.com/allsrc/agent-taskbay/issues/31)).

### Changed

- Production builds use webpack (`next build --webpack`) so the build can be shipped through npm. Development still uses Turbopack.
- In explicit demo mode (development identity on a production build) the outbound origin allowlist is no longer mandatory; a configured
  allowlist is still enforced and every other production profile still requires one (amends [ADR 0014](docs/archive/adr/0014-service-credentials-and-scoped-security.md)).
- `package.json` is publishable: `private` removed, `bin`, `files` and `publishConfig` added, duplicate `keywords` merged.
