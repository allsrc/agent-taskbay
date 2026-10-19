# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [semantic versioning](https://semver.org/) once it reaches 1.0; until then minor versions may change interfaces.

## [Unreleased]

### Added

- **IDs are labeled and copyable.** Every ID in chat, task pages, approvals and the task browser now says what it is (Task ID, Context ID, Message ID, Artifact ID, Call ID, Taskbay ID, Approval ID, Command ID, Digest), with a copy icon that copies the whole value. Selecting a label explains the ID: its protocol field, whether A2A defines it or only Taskbay keeps it, its full value and who creates it. The task page's **Identifiers** panel is rebuilt around this, shows each message's ID in **History**, lists artifact and referenced-task IDs, wraps very long values and folds those over 100 characters behind **Show all**. Copying works over plain HTTP, and the chat header's context ID moves to its own row on a phone.

### Fixed

- **Link-styled outline buttons had no border.** `buttonVariants()` returned a raw class string, so an outline button built from a link kept both `border-transparent` and the variant's border colour, and the transparent one won. "Back to tasks", **Export CSV**, **Add agent** and similar looked like plain text. They now render as buttons.
- **Audit trail no longer drops you out of Administration.** It opens inside Administration at `/admin/audit` with the tabs still visible; `/audit` sends administrators there. **Find tasks** no longer shows a redundant "Back to tasks" button, and **Disable** on a team looks like a button.

### Changed

- **Console navigation is reorganised by job.** The sidebar groups daily work (**Home**, **Inbox**, **Tasks**, **Chat**), **Agents** (**Agents**, **Find tasks**, **Orchestration**) and **You** (**Notifications**, **Settings**, **Administration** for administrators).
- **Administration is its own area** (`/admin`) with **Overview**, **People**, **Teams**, **Agent access** and **Policies & alerts**, plus a link to the audit trail. It replaces the organization cards that sat under **Settings**, which now holds only your browser-stored request defaults and extensions. **Teams** gains **Disable team**. No API changed.
- **People management in the console.** With OIDC sign-in, **Administration → People** can add a person, change a role, deactivate and reactivate, all audited (`member.*`) and with the same guards as the API: you cannot change or deactivate yourself. In local development mode the page shows the built-in administrator and explains that people need OIDC. `POST /api/admin/security` gains `provisionMember`, `changeRole`, `deactivateMember` and `reactivateMember`; `GET` adds `identity` and `inactiveMemberships`.
- **Dev server serves `127.0.0.1`.** `next dev` now allows the `127.0.0.1` origin, which the launcher and docs print; before, the page loaded there but never became interactive.
- **Browsing an agent's tasks is a page, not a dialog.** **Find tasks** (`/discover`) works across agents and is linked from the sidebar, the **Tasks** list and each agent's **Task discovery** card.

- **Clear errors when the embedded database cannot be opened.** PGlite has no lock of its own, so a second process (for example `npm run db:migrate` while `npm run dev` runs) could open the same folder silently and damage it. Taskbay now takes a `<folder>.lock` file and refuses with "already open in another process"; a stale lock from a dead process is taken over. A damaged folder, which made PGlite end the whole process with `RuntimeError: Aborted()`, now fails the open with an error that says what to do. Background workers print the reason once instead of a bare "will retry" in a loop. Nothing is deleted or moved automatically.

### Added

- **Browse and track tasks started elsewhere.** **Browse tasks** on an agent page reads live `ListTasks` pages without storing them; **Track** and **Track by task ID** re-read and store one task to answer, steer, cancel or claim. Requires an administrator or whole-agent `operate` grant. Stored tasks carry **Discovered** labels, an origin filter and tracking details; tracking never claims a task or notifies people about its first stored state. The **Task discovery** card defaults to **Browse only**, with **Off** and a deployment-wide `A2A_TASK_DISCOVERY` cap. Schema version 2.
- **Automatic discovery is opt-in.** With `A2A_TASK_DISCOVERY=auto`, an administrator can set an agent to **Automatic**. Workers then store eligible unknown tasks: finished history defaults to 7 days (0–90), with at most 500 new tasks on the first sweep, 200 on later sweeps and 5,000 discovered tasks per agent before pausing. First sight notifies only for input or authorization requests updated within 24 hours; later changes notify normally. Schema version 5.
- **Demo work started elsewhere.** `npx agent-taskbay demo-agent` includes an `automation` card with existing tasks, and the quickstart walks through browsing, tracking and answering one.
- **Extended Agent Cards.** Administrators can **Fetch** and **Refresh** a validated extended card with the stored agent credential; whole-agent readers see extra skills marked **Authenticated**. Extended cards are stored separately and do not change routing, grants or extension negotiation. Schema version 7; upgrade all web and worker instances before the first extended-card fetch.
- **Connection details and tenant selection.** The agent page shows the binding, interface, protocol version, tenant and extension negotiation. New conversations can select a tenant from the card; existing conversations retain their stored tenant.
- **Task filters and context views.** `GET /api/tasks` filters by context, agent, update time and origin, and pages with an opaque `after` cursor. Task pages link to **Other tasks in this context**, with a removable context filter in the list. Schema version 6.
- **Related tasks.** User and agent messages’ `referenceTaskIds` become durable **References** and **Referenced by** links within one organization, agent and tenant, limited to tasks the reader may access. Links survive restarts and projection rebuilds; unknown references are not fetched. Schema version 8.
- **Assisted cancellation.** **Cancel this task and related tasks** in task pages and chat lets a person choose eligible tasks and request cancels sequentially. **Cancel this and related** preselects all eligible tasks; other entry points select only the current task. Each result appears separately, failures do not stop other selections, and completed runs record `task.cancel.related` with browser-reported counts only.
- **Steering outcomes.** Extra input sent to a running task shows **Delivered**, **Agent responded**, **Agent refused: …**, **Waiting for a response** (then **No response yet** after 60 seconds), or **Not sure it arrived**. Detail responses derive `steering` from commands and the ledger; no outcome proves that the agent used the input.
- **Stop and restart with this.** Chat requests cancellation, confirms the old task is finished, then starts a new task in the same context referencing it. Progress shows both results; retries use ordinary idempotent commands and never automatically resend an uncertain outcome.
- **Load agent history.** Chat requests 1–200 retained messages (default 50; 6 requests per minute per task). Newly found messages appear under **History the agent returned** with `origin: "agent-history"`, separate from **What Taskbay received**; repeated loads do not duplicate messages or replace the ledger.
- **Push cleanup.** The worker removes Taskbay’s leftover push configurations from finished tasks when their IDs or callback paths identify them as its own. Other callbacks are left alone, each task is checked at most daily, and removals record `push.cleanup.<count>`.
- **Development fixtures.** `scripts/fixture-scenario-agent.mjs` provides controllable protocol scenarios. `scripts/fixture-content-agent.mjs` streams mislabeled text, common tool-call and result shapes, and long content. These development fixtures are not shipped in the npm package.

### Changed

- Definite A2A refusals settle commands as `rejected` with an `errorKind`, while unknown failures after dispatch stay `uncertain`. Chat and task pages explain failures by kind, including whether to check the task or start a new one; remote refusal text is not stored or returned. Schema version 3.
- Sending to or canceling a finished task is refused locally with `409` and `task_terminal`. Continue as a new task in the same context.
- Unsupported extensions marked `required: true` block sends until an administrator explicitly overrides the block on the agent page or through its settings route. Cancels remain available and overrides are audited. Schema version 4.
- Migrations use numbered names and the release declares its required schema version (now 8). The sixteen development migrations are consolidated into a baseline; older databases that applied all sixteen are adopted unchanged. Incomplete legacy databases must first start `agent-taskbay@0.2.0` to finish those migrations.
- Startup reports database creation and upgrades. Before upgrading an existing PGlite directory, it keeps a `<dir>.backup-v<schema version>-<timestamp>` copy (newest three retained); a database newer than the release is refused.
- Sent chat messages use a soft brand surface, and sender labels distinguish **You** from the agent’s name and avatar.
- Long content folds behind **Show all N lines**: messages and results after about 20 lines, compact steps and JSON values after 6. Multi-line JSON strings retain line breaks; trees and tables page at 100 entries, and expanded cards have bounded scrolling.
- Text viewers offer useful alternate formats without changing stored or outgoing content. Mislabeled agent JSON and Markdown use a fitting view; prose is not offered as CSV. HTML stays source until **Preview HTML** opens a sanitized, isolated document, with scripts and remote assets blocked.
- Intermediate messages and structured activity fold into **Progress** and **Activity**. Tool calls, results, code, reasoning and other data show summaries with names, IDs and previews, including common framework shapes and `adk_author`; final replies and results stay visible without duplication.
- Streaming-capable agents default chat’s `returnImmediately` option on; the per-chat **Options** switch can override it. New chats select their conversation on the first committed task snapshot.
- Documentation consolidates the implemented capabilities, discovery limits, failure handling and verification, and records guided authorization and signed incoming push as future work.

### Fixed

- Tenant selection uses the matching interface URL within connection pins. New tasks store the effective default tenant, and automatic discovery avoids empty-tenant alias copies while preserving legacy records.
- Supported required extensions are declared in A2A request headers, and empty SDK task lists show a normal empty state.
- Restart retries create a fresh command after a definite refusal and recheck the same command for uncertain outcomes. Stored inline attachments are restored through current artifact permissions before cancellation, preserving the original file bytes.
- Markdown in chat links only explicitly authored links and autolinks; bare addresses, emails and paths stay plain text. Links open in a new tab with `noopener noreferrer nofollow`.
- Chat follows new content after layout, preserving bottom padding and keeping the latest reply, quick replies and forms above the composer on desktop and phone. Scrolling up pauses following; sending resumes it.
- Questions that require input or authorization and the agent’s final reply stay visible instead of folding into **Progress**.
- Status-message metadata and the state that carried it survive stored task projections. Run `npm run db:projections:rebuild` to refresh earlier records; they also refresh on their next event.

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
