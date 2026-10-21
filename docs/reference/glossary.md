# Glossary

> Who this is for: anyone reading the Taskbay docs who meets an unfamiliar term. You will have a short definition of each term and a link to the page that explains it in full.

Terms are in alphabetical order. Taskbay is pre-1.0, so names and behavior can change between minor versions.

## On this page

- [A to C](#a-to-c)
- [D to H](#d-to-h)
- [I to P](#i-to-p)
- [R to V](#r-to-v)

## A to C

**A2A**\
The Agent2Agent protocol that Taskbay speaks as a client, over JSON-RPC or HTTP+JSON (gRPC is refused). Taskbay accepts A2A 1.0 agents, and v0.3 agents through the SDK's compatibility mode. See [Compatibility](compatibility.md).

**A2UI**\
A format in which an agent describes a small interface as JSON, and the console draws it with its own components. Taskbay renders a subset of the v0.9 Basic Catalog in the chat view, only for agents that advertise the A2UI extension. See [A2UI reference](a2ui.md).

**AG-UI**\
A protocol spoken by AG-UI client runtimes, separate from A2A. Taskbay does not speak it to agents; it can only expose an A2A agent to an AG-UI client through the AG-UI adapter. See [Rich content](../concepts/rich-content.md#ag-ui-adapter).

**AG-UI adapter**\
An experimental route, `POST /api/agents/{agentId}/ag-ui`, that lets an AG-UI client drive a durable A2A task. It is off unless `A2A_AGUI_ENABLED=true`; otherwise the route answers 404. Each run is one durable command, and an interrupt answer is a reply, not an approval. See [AG-UI adapter reference](ag-ui.md) and [Try the AG-UI adapter](../guides/enable-ag-ui.md).

**Agent Card**\
The JSON document an A2A agent publishes to describe itself: its interfaces, skills, capabilities (such as streaming and push), security schemes and the extensions it supports. Taskbay reads it when you register the agent and decides what to offer from it. See [Connect an agent](../guides/connect-an-agent.md).

**Agent credential binding**\
The one encrypted credential Taskbay holds for an agent, together with the exact HTTPS origins it may be sent to (1 to 20). The kinds are `apiKey`, `bearer`, `oauthClient` and `mtls`. You store, revoke and re-encrypt it with `npm run security:credentials`; the browser never sees the secret. See [Agent credentials](../guides/agent-credentials.md).

**Agent history**\
The messages an agent retains for a task, which may be more or less than Taskbay’s record. **Load agent history** requests a bounded history and labels newly found messages separately; it never replaces the ledger. See [Taskbay’s record and the agent’s history](../concepts/durable-tasks.md#taskbays-record-and-the-agents-history).

**Approval (decision request)**\
A request for a person to authorize one proposed action on a task, stored as a `DecisionRequest` separate from the task itself. The outcomes are `approve`, `reject`, `edit`, `request_changes` and `delegate`, and an approval sends exactly the approved revision to the agent, once. An `INPUT_REQUIRED` or `AUTH_REQUIRED` task is never an approval. See [Human in the loop](../concepts/human-in-the-loop.md#approvals).

**Artifact and artifact store**\
An artifact is an output an agent attaches to a task, made of text, data or file parts. The artifact store is a directory (`A2A_ARTIFACT_DATA_DIR`) where the server keeps binary parts and the original protocol events, named by content digest; database rows hold only metadata. See [Rich content](../concepts/rich-content.md) and [Configuration](configuration.md#database-and-storage).

**Audit trail**\
A read-only, newest-first timeline of who did what: approvals and their exact content, ownership changes, sign-ins, provisioning, agent and credential changes, and sent messages. Records are append-only by database trigger, which is immutability, not cryptographic tamper evidence. The organization-wide trail is for administrators. See [Human in the loop](../concepts/human-in-the-loop.md#audit-trail).

**Automatic discovery**\
An opt-in mode where a worker stores tasks another system started. The deployment must allow `auto`, and an administrator sets the agent to **Automatic**. History, per-sweep and per-agent limits bound what is stored. See [Task discovery](../guides/connect-an-agent.md#task-discovery).

**Browse**\
Read an agent’s live task list without storing it. Requires an administrator or whole-agent operate access; choose **Track** to keep and follow one task. See [Find and steer tasks started elsewhere](../guides/find-and-steer-tasks-started-elsewhere.md#find-a-task-and-track-it).

**Cancel related tasks**\
Choose stored tasks in **Cancel this task and related tasks** and request each cancel separately. Only eligible checked tasks are sent, each with its own idempotency key and result. The agent may refuse; message references never trigger automatic cancellation. See [Related tasks](../guides/use-the-console.md#related-tasks).

**Command (durable command)**\
A send, reply or cancel that Taskbay saves to the database with an outbox row before answering `202 Accepted`; a worker then delivers it to the agent. Its status moves from `pending` through `dispatching` to `succeeded`, or ends `failed`, `uncertain` or `rejected`. A `rejected` command is one the agent refused with a definite error (it did nothing, so a resend is safe). An `uncertain` command is never resent automatically. See [Durable tasks](../concepts/durable-tasks.md#the-path-of-a-command).

**Context (`contextId`)**\
The A2A identifier an agent uses to group related tasks and messages. In the console, a conversation is the set of tasks that share one agent, tenant and `contextId`. A person with only skill grants cannot send a `contextId` without a task ID, so each of their new tasks starts a new context. A task page lists the other tasks in its context, and the Tasks list can be narrowed to one. See [Use the console](../guides/use-the-console.md).

## D to H

**Development identity (local mode)**\
The sign-in mode where every request is one local administrator, "Local operator", in the organization with slug `local`. It is the default outside production and for the `npx agent-taskbay` launcher, which then refuses to listen on a non-loopback address. A production build accepts it only with both `A2A_AUTH_MODE=development` and `A2A_ALLOW_DEVELOPMENT_AUTH=true`. See [Sign in and roles](../guides/sign-in-and-roles.md#local-development-identity).

**Discovered task**\
A task that exists on an agent but was not started from Taskbay, and that Taskbay now stores because a person tracked it from the agent's task list or automatic discovery found it. It is marked `origin: discovered`, initially has no owner and has no skill, and is visible only to people with access to the whole agent. See [Task discovery](../guides/connect-an-agent.md#task-discovery).

**Embedded and external worker**\
The worker is the set of background loops that dispatch commands, hold streams, poll agents, sweep approvals and send notifications. Embedded mode (the default) runs them inside the web server process; external mode (`A2A_COMMAND_WORKER_MODE=external`) runs them as `npm run worker:tasks` and requires PostgreSQL. See [Running and workers](../operations/running-and-workers.md).

**Escalation and due time**\
A due time is a deadline set on a task's assignment, in the future and within a year. When it passes, the escalation sweep hands the task once to the target named in an administrator's escalation policy (for the organization or one agent) and raises its escalation level. With no enabled policy, the task is only shown as overdue. See [Human in the loop](../concepts/human-in-the-loop.md#ownership-due-times-and-escalation).

**Extended Agent Card**\
An authenticated card fetched by an administrator using an agent’s stored credential. It is saved separately from the public card, and whole-agent readers can see extra skills marked **Authenticated**. It does not change routing, grants or extension negotiation. See [Extended Agent Card](../guides/connect-an-agent.md#extended-agent-card).

**Extension**\
A capability an agent advertises by listing its URI in the Agent Card; `required: true` means unsupported sends are blocked unless an administrator overrides it. Taskbay defines three: the structured form (typed input fields), the approval request (the agent opens an approval itself) and skill routing (enforces skill-only grants). It also renders the A2UI extension. See [Extensions reference](extensions/README.md).

**Grant (agent grant, skill grant)**\
A rule that gives a subject `read` or `operate` permission on one agent (agent grant) or on one skill of it (skill grant). Grants add up, `operate` includes `read`, and a non-admin with no grant sees nothing. A skill grant lets people send only to agents that advertise skill routing. See [Give people access to agents and skills](../guides/teams-and-grants.md).

## I to P

**Identifier (ID)**\
A value that names one thing. The console labels each one (Task ID, Context ID, Message ID, Artifact ID, Referenced task, Call ID, Taskbay ID, Approval ID, Command ID, Digest), says whether the A2A protocol defines it or only Taskbay keeps it, and offers a copy icon. See [Identifiers](../guides/use-the-console.md#identifiers).

**Inbox**\
One list of the tasks and approvals you may read, across agents. Its views are **Needs you** (the default), **Mine**, **Overdue**, **Active**, **Done** and **All**, with **Show** and **Risk** filters. See [Approvals and ownership](../guides/approvals-and-ownership.md#find-work-the-inbox).

**Notification**\
An in-app message to a person, such as an approval waiting or a task assigned or escalated, raised in the same transaction as the event. Read state is per person, and revoking access hides what a notification said. See [Notifications](../guides/notifications.md).

**Notification webhook**\
An optional signed HTTP POST that Taskbay sends out for each notification to one URL per deployment (`A2A_NOTIFY_WEBHOOK_URL`, signed with HMAC-SHA256). It is outgoing, and is not the same as a push callback. See [Notifications](../guides/notifications.md#set-up-the-webhook).

**OIDC**\
OpenID Connect, the production sign-in mode and the default when `NODE_ENV=production`. A person signs in through your identity provider, and Taskbay admits them only if that exact issuer and subject already has an enabled membership; there is no just-in-time account creation. See [Sign in and roles](../guides/sign-in-and-roles.md#set-up-oidc).

**Organization**\
The owner of everything in a deployment: agents, tasks, memberships, teams, grants and audit records. A deployment serves one organization (`A2A_AUTH_ORGANIZATION_SLUG` with OIDC, `local` in development), and there is no organization switcher. See [Identity and access](../concepts/identity-and-access.md#organizations-roles-teams-and-grants).

**Origin allowlist**\
The list of exact origins in `A2A_ALLOWED_AGENT_ORIGINS` that outbound calls may reach: Agent Card and interface URLs, OAuth token endpoints and the notification webhook. It is required in production (except demo mode). It is separate from the origins in a credential binding, which limit where that one credential is sent. See [Configuration](configuration.md#outbound-network-policy).

**PGlite and PostgreSQL profiles**\
The two database profiles, chosen with `A2A_DATABASE_PROFILE`. PGlite (the default) is an embedded, file-backed database owned by one process, for local use. PostgreSQL (`A2A_DATABASE_URL`) is for production and is required for external workers. See [Configuration](configuration.md#database-and-storage).

**Plane A and Plane B**\
Names used in the security pages for two separate kinds of authentication. Plane A is how a person signs in to the console; Plane B is how the console authenticates to an agent with a vault credential. Plane A tokens are never reused for Plane B. See [Identity and access](../concepts/identity-and-access.md).

**Projection and projection rebuild**\
A projection is the current-state view of a task (header, messages, artifacts) that the screens read, derived from the append-only event ledger. A rebuild (`npm run db:projections:rebuild`) recomputes projections from retained events and archives without contacting any agent, and keeps the old projection if it fails. See [Upgrading and backups](../guides/upgrading-and-backups.md#rebuild-projections).

**Push callback**\
An A2A push notification an agent sends into Taskbay at `POST /api/webhooks/a2a/<registration id>`, with a per-registration bearer token. It is opt-in (`A2A_PUSH_CALLBACK_ORIGIN` and `A2A_PUSH_SIGNING_KEY`) and only makes changes arrive sooner; reconciliation still runs. See [Receive push callbacks from agents](../guides/agent-push-callbacks.md).

## R to V

**Reconciliation**\
Polling that keeps tasks current when streams and push miss something: `GetTask` for each open known task about every 15 seconds, and `ListTasks` per agent about every 60 seconds. It refreshes known tasks and, only in automatic discovery mode, can also store unknown tasks within limits. It never reopens a finished task. See [Durable tasks](../concepts/durable-tasks.md#keeping-a-task-current-without-a-browser).

**Related task**\
A stored task linked to another by `referenceTaskIds` on a user or agent message. The task page shows **References** and **Referenced by**, restricted to tasks you may read. Resolution stays within the same organization, agent and tenant; a link is not a parent-child relationship or a rule for cancellation. See [Related tasks](../guides/use-the-console.md#related-tasks).

**Required extension**\
An Agent Card extension marked `required: true`. An unsupported required extension blocks sends until an administrator explicitly overrides it; cancels remain available. See [Required extensions](../guides/connect-an-agent.md#required-extensions).

**Restart with this instruction**\
A two-step action in chat: request cancellation, confirm the old task is finished, then start a new task in the same context referencing it. A refusal or unknown result can prevent the new task from starting. See [Stop and restart with this instruction](../guides/use-the-console.md#stop-and-restart-with-this-instruction).

**Revision and content digest**\
A revision is a numbered, immutable version of an approval's proposed action; a new proposal or a reviewer's edit creates the next one. Its content digest is the SHA-256 of the canonical action. A decision names the revision the reviewer read and fails with `409` if a newer one exists. See [Human in the loop](../concepts/human-in-the-loop.md#approvals).

**Role (admin, operator, viewer)**\
The baseline a membership may do: `admin` does everything in the organization, `operator` works on granted agents and skills, and `viewer` only reads. "Reviewer" is not a role: it means an enabled `operator` or `admin` who can decide an approval, and the escalation target must also be one. See [Sign in and roles](../guides/sign-in-and-roles.md#roles).

**Separation of duties**\
The approval rule that the person who opened a request cannot decide it. It is on by default; a request's policy can turn it off. See [Human in the loop](../concepts/human-in-the-loop.md#approvals).

**Steer**\
Send more input to a task that is already working. A2A carries the message; the agent decides whether and how to use it. See [Sending more input to a running task](../guides/use-the-console.md#sending-more-input-to-a-running-task).

**Steering outcome**\
What Taskbay can observe after extra input was sent to a running task: delivered, followed by agent activity, refused, waiting or unknown. It does not prove that the agent used the input. See [Sending more input to a running task](../guides/use-the-console.md#sending-more-input-to-a-running-task).

**Subject**\
The recipient of a grant: the whole organization, one person (a membership) or one team. In the API these are `subjectType` values `organization`, `membership` and `team`. See [Give people access to agents and skills](../guides/teams-and-grants.md#how-roles-and-grants-combine).

**Task and task state**\
A task is a unit of A2A work that Taskbay keeps as a database record, keyed by its own ID, so it survives a closed browser. Its state comes from the agent: `SUBMITTED`, `WORKING`, `INPUT_REQUIRED` (the agent asks a question), `AUTH_REQUIRED` (the agent needs authorization resolved out of band), or a terminal `COMPLETED`, `FAILED`, `CANCELED` or `REJECTED`. See [Durable tasks](../concepts/durable-tasks.md) and [Identity and access](../concepts/identity-and-access.md#in-task-auth_required-and-input_required).

**Task discovery**\
The per-agent choice **Browse only**, **Automatic** or **Off**, limited by `A2A_TASK_DISCOVERY` for the deployment. It controls finding tasks started elsewhere; existing stored tasks continue to refresh in every mode. See [Task discovery](../guides/connect-an-agent.md#task-discovery).

**Team**\
A named group of memberships that an administrator creates in **Administration** so one grant can cover several people. Teams cannot be renamed or deleted, cannot be escalation targets, and are not synced from identity-provider groups. See [Give people access to agents and skills](../guides/teams-and-grants.md).

**Tenant**\
An A2A scope that is part of remote task identity together with the agent and remote task ID. New conversations select a tenant from the card’s interfaces; existing conversations retain their stored tenant. It is separate from Taskbay’s organization. See [Connection and tenant](../guides/connect-an-agent.md#reading-the-connection-card).

**Track**\
Re-read a known remote task with `GetTask`, store it as discovered and follow it. Tracking needs whole-agent operate access, does not claim the task and does not notify people about its first stored state. See [Find a task and track it](../guides/find-and-steer-tasks-started-elsewhere.md#find-a-task-and-track-it).

**Trust pin**\
A public key you pin for an Agent Card origin in `A2A_TRUSTED_CARD_KEYS`, used to verify the card's signature. A signed card that fails verification cannot be used, and `A2A_REQUIRE_SIGNED_CARDS=true` also rejects unsigned cards. Trust concerns the agent's identity, not who may use it. See [Agent credentials](../guides/agent-credentials.md#agent-card-trust-pins).

**Vault and vault key ring**\
The vault is the encrypted `agent_credentials` table that holds credential bindings (JWE, AES-256-GCM). The key ring is `A2A_VAULT_KEYS`, a set of keys of which `A2A_VAULT_ACTIVE_KEY` encrypts new values while older keys still decrypt, so you can rotate. See [Agent credentials](../guides/agent-credentials.md#set-up-the-vault-key-ring).

## Related

- [Overview](../concepts/overview.md)
- [Use the console](../guides/use-the-console.md)
- [Configuration reference](configuration.md)
- [Data model reference](data-model.md)
- [Docs index](../README.md)
