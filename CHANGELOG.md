# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [semantic versioning](https://semver.org/) once it reaches 1.0; until then minor versions may change interfaces.

## [Unreleased]

### Changed

- The sixteen development-period migrations are squashed into one baseline. Databases that applied all of them are adopted unchanged; ones missing some are refused with instructions to start `agent-taskbay@0.2.0` once.
- On start, `npx agent-taskbay` and `npm run dev` say whether they are creating a new database or upgrading an existing one. An existing PGlite database is copied to `<dir>.backup-<timestamp>` before it is upgraded (newest 3 kept), and nothing is printed when it is already current.
- Sent messages use a soft brand surface instead of the primary action color.
- Long content is folded with a **Show all N lines** toggle instead of stretching the conversation: messages and results after about 20 lines, progress steps, reasoning and JSON values after 6. Multi-line strings inside JSON keep their line breaks, JSON trees and tables page at 100 entries, and expanded data cards scroll inside a capped height. Code with commas is no longer offered as CSV.
- Text in chat can be viewed another way without changing stored data. Ordinary text carries no controls; text with another useful view gets a **Format as …** / **Plain text** toggle and a menu naming the declared type with Text, Markdown, valid JSON, CSV and Sanitized HTML. An agent's content that does not fit its declared media type is shown as what it is: Markdown or JSON sent as `text/plain`, JSON labelled `text/html` or `text/markdown`, Markdown labelled `application/json`; an HTML page labelled `text/markdown` becomes contained source, and `text/csv` prose stays text. HTML is opt-in: its source shows in a contained block, with **Preview HTML** opening a sanitized, styled document in an isolated iframe (dialog on desktop, sheet on phones), scripts and remote resources blocked.
- In chat, each run of messages now carries a label saying who is speaking ("You", or the agent's name with its avatar), so your messages are easy to tell apart from the agent's.
- In chat, explicitly tagged or tool-shaped calls and results (including Google ADK `function_call` and `function_response` parts) fold into one quiet **Activity** log, with each entry opening to its JSON. Generic JSON artifacts remain visible as results. Consecutive agent messages before the reply fold into **Progress**. A final message that only repeats a finished text result is no longer shown twice.
- For agents whose card advertises streaming, chat defaults `returnImmediately` on so Taskbay can subscribe to the active task and show updates sooner. The per-chat **Options** switch can turn it off.
- New chats select their conversation on the first committed task snapshot, keeping streamed updates visible while the task runs.
- Status updates fold into **Progress** while the agent works. Progress and Activity share one step design: text updates read as lines, and structured parts become one-line steps that open to their JSON. A step names its kind (tool call, result, code, code output, reasoning, error or data), the tool or best title, the call id and a short preview, recognizing Google ADK (including `tool_response`), OpenAI, Anthropic, LangChain / LangGraph, Vercel AI SDK and MCP shapes; a result carrying only a call id takes the call's name, and arbitrary JSON is summarized by its title, id and first fields instead of `[data]` or a bare media type. A sub-agent author (`adk_author`) is shown when it differs from the agent.

### Added

- `scripts/fixture-content-agent.mjs`, a streaming sample agent that sends content under the wrong media type (cases in `scripts/fixtures/mislabeled-content.json`, shared by its tests) and, with `tools` and `long`, tool calls, results, reasoning and other JSON in common framework shapes, and 700-line content.

### Fixed

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
