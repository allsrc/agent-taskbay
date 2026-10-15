# Decisions

> Who this is for: anyone implementing a task. These are settled. If new evidence contradicts one, stop, record it in your task's Notes for later and ask the maintainer; do not silently deviate.

## D-01. `auth-required` stays on the roadmap

Taskbay keeps showing the state and the existing text ("reply here to resume"). It does not build an authorization handoff in this plan. T-23 records the design sketch as roadmap work (issue [#1](https://github.com/allsrc/agent-taskbay/issues/1)). No task here may add authorization URLs, resume buttons or credential exchange.

## D-02. Task discovery: browse and track by default, automatic discovery opt-in

**Why.** The strongest use case is steering work an automated process started: a pipeline starts an agent and the agent pauses for input. A person must be able to find that task and take it over. But Taskbay should not quietly copy and follow everything an agent can see.

**Three modes, per agent** (`taskDiscovery`):

| Mode | What Taskbay does | Default |
| --- | --- | --- |
| `browse` | When a person asks, lists the agent's tasks live (`ListTasks`, nothing stored). The person chooses **Track** for a task; only then is it stored, followed (stream, push, polling) and visible in Tasks and the Inbox. | **Yes** |
| `auto` | A background sweep also stores and follows tasks started elsewhere, within the limits in D-12 and the notification rules in D-13. | No |
| `off` | Taskbay never lists the agent's tasks. | |

A deployment-wide cap, `A2A_TASK_DISCOVERY` = `off`, `browse` (default) or `auto`, sets the highest mode any agent may use. `browse` forbids `auto`; `off` forbids both.

**What it means.**

- Nothing about a task started elsewhere is stored until someone tracks it (or `auto` is on). Browse results are never persisted or cached.
- Browsing needs the **operate** permission on the **whole agent** (or admin). Skill-scoped principals cannot browse and never see tracked or discovered tasks, because their `skill_id` is null and `taskAccessFilter` only matches skill-scoped grants against a named skill.
- The feature reads only with the credential already bound to the agent. It adds no new access to the agent.
- Tracking is a deliberate action and is audited. After it, the task behaves like any other: inbox, notifications, ownership, steering, cancel.
- This is a first-development-stage product, so there is no upgrade-compatibility work for existing agents beyond the default value. No upgrade banner.

**The risk, and mitigations.** An agent credential is deployment-wide, so it may see tasks that belong to other people. Browse shows them to anyone with an operate grant on the whole agent.

| Mitigation | Where |
| --- | --- |
| Whole-agent operate permission required to browse | T-08 |
| Nothing stored until tracked; tracking audited with who and which task | T-08 |
| Per-agent mode and deployment cap | T-07, T-10 |
| Disclosure at connect time and on the agent page | T-10 |
| Hard caps for `auto` (D-12) | T-25 |
| Tracked and discovered tasks marked everywhere | T-11 |

## D-03. A2A error names, verified against `@a2a-js/sdk` 1.3.0

Read from `node_modules/@a2a-js/sdk/dist/errors/index.js` (package export `@a2a-js/sdk/errors`). Every error extends `A2AError`, has a string `reason`, and the JSON-RPC variants carry `envelopeCode`; the REST variants carry `statusCode`.

| Class (`error.name`) | `reason` | JSON-RPC code | Did the agent execute the request? | Taskbay classification |
| --- | --- | --- | --- | --- |
| `TaskNotFoundError` | `TASK_NOT_FOUND` | -32001 | No | `rejected` |
| `TaskNotCancelableError` | `TASK_NOT_CANCELABLE` | -32002 | No | `rejected` |
| `PushNotificationNotSupportedError` | `PUSH_NOTIFICATION_NOT_SUPPORTED` | -32003 | No | `rejected` |
| `UnsupportedOperationError` | `UNSUPPORTED_OPERATION` | -32004 | No | `rejected` |
| `ContentTypeNotSupportedError` | `CONTENT_TYPE_NOT_SUPPORTED` | -32005 | No | `rejected` |
| `InvalidAgentResponseError` | `INVALID_AGENT_RESPONSE` | -32006 | **Maybe**: the agent produced a bad response | `uncertain` |
| `ExtendedAgentCardNotConfiguredError` | `EXTENDED_AGENT_CARD_NOT_CONFIGURED` | -32007 | No | `rejected` |
| `ExtensionSupportRequiredError` | `EXTENSION_SUPPORT_REQUIRED` | -32008 | No | `rejected` |
| `VersionNotSupportedError` | `VERSION_NOT_SUPPORTED` | -32009 | No | `rejected` |
| `RequestMalformedError` | `INVALID_PARAMS` | -32602 | No | `rejected` |
| JSON-RPC internal error | none | -32603 | Unknown | `uncertain` |
| Network error or timeout after the request left | none | none | Unknown | `uncertain` (unchanged) |

Notes that matter for the code:

- The SDK matches classes by name up the prototype chain (`Symbol.hasInstance`), so `error instanceof TaskNotFoundError` works across bundles, but this repository already compares `error.name` (see `reconciliation-gateway.ts`). Prefer `reason` and fall back to `name`, then `envelopeCode`.
- `executeOperation` in `src/lib/gateway.ts` replaces any error from a **protected** connection (one with secret values) with `new Error("Protected agent operation failed.")` and copies only `name` and `envelopeCode`. T-03 must also keep `reason` and the REST `statusCode` in that wrapper, and must not leak the remote message.
- The SDK folds JSON-RPC -32700, -32600 and -32601 into `RequestMalformedError` (reason `INVALID_PARAMS`), keeping the real code in `envelopeCode`. The classifier therefore reads `envelopeCode` first, so "method not found" is `unsupported_operation`, not `invalid_request`. -32603 and unknown codes arrive as a generic `JsonRpcTransportError` with no reason and stay `uncertain`.
- HTTP-level failures (401, 403, 429) are transport errors, not A2A errors. T-03 classifies them from the status code where the SDK exposes it and otherwise leaves them `uncertain`.
- The A2A error list, plus the four standard JSON-RPC protocol errors an agent returns before running anything (-32700 parse error, -32600 invalid request, -32601 method not found, -32602 invalid params), are the only sources of `rejected`. Anything else is `uncertain`.

## D-04. Vocabulary

| User-facing term | Means | Never say |
| --- | --- | --- |
| Discovered | A task that exists on the agent, was not started from Taskbay, and is now stored (tracked by a person, or found by automatic discovery) | Imported, synced, scraped |
| Task discovery | The setting and the feature, with modes **Browse only**, **Automatic**, **Off** | Import |
| Browse | Look at the agent's tasks live; nothing is stored | List all, sync |
| Track | Store a browsed task and follow it | Import, adopt, subscribe |
| Started elsewhere | Long-form explanation of "discovered" | |
| Steer | Send a message to a task that is already working | Interrupt, override |
| Restart with this instruction | Cancel a task, then start a new one in the same context referencing it | Replace, redirect |
| Related tasks | Tasks linked by `referenceTaskIds` | Parent, child (A2A has no hierarchy) |

Code and data keep `origin: "discovered"`; the setting column is `taskDiscovery`.

## D-05. `SendStreamingMessage` stays unused

Commands go out as `SendMessage` with `returnImmediately`, and workers then subscribe. This preserves the outbox and lease model and survives a closed browser. Do not change it in this plan.

## D-06. Steering outcome is computed, not stored

For each message a user sends to a working task, the outcome (`delivered`, `responded`, `refused`, `waiting`) is derived at read time from the command row and the task ledger. No new table. See T-15.

## D-07. "Restart with this instruction" is client-orchestrated

Two ordinary idempotent commands in sequence (cancel, then send), driven by the UI, with the second blocked unless the first succeeded. No new server-side macro endpoint. See T-16.

## D-08. No task-lineage extension

Related tasks come from `referenceTaskIds` only. We do not define an extension for parent/child reporting. Revisit when a real agent reports child task IDs.

## D-09. Migrations run one task at a time

Only one migration exists today (`Migration0001_Baseline`). Tasks that add a migration are marked `migration: yes` in the tracker, which refuses to start two at once. Each takes the next free number when it starts.

## D-10. Retention and purge are out of scope

Tracked as a known limit already. Needs its own design; do not add purge here. Discovery's caps (D-12) bound growth in the meantime.

## D-11. Discovery reads only what the credential can list

Browsing and automatic discovery use `ListTasks` with the agent's bound credential, per tenant. They never guess task IDs. **Track** accepts one task id (from a browse row, or typed or pasted by a person with the same permission) and re-reads it with `GetTask`; it never accepts task content from the browser (D-15).

## D-12. Automatic discovery limits (mode `auto` only; constants, documented, not configurable in this plan)

| Limit | Value | Why |
| --- | --- | --- |
| Terminal tasks discovered on the first sweep | Only those updated in the last `taskDiscoveryHistoryDays` days (default **7**) | Avoid importing years of history |
| Non-terminal tasks | Always discovered | They can still need a person |
| Per sweep | 200 new tasks (first sweep 500) | Bound each transaction batch |
| Per agent in total | 5 000 discovered tasks, then discovery pauses with a visible message | Bound growth |
| Page size requested | 100 (the protocol cap the reconciler already enforces) | |
| Incremental window | `statusTimestampAfter = lastSyncedAt − 5 minutes` | Tolerate clock skew |
| Full sweep | At least once per hour | Safety net for missed timestamps |

## D-13. Notifications for automatically discovered tasks

Applies to mode `auto`. A **tracked** task never has a first-sight notification (the person just chose it); later state changes notify as for any task.

An automatically discovered task must not flood people with old news.

- First sight of a task that needs a person (`INPUT_REQUIRED`, `AUTH_REQUIRED`) notifies **only if** its remote status timestamp is within the last 24 hours.
- First sight of `COMPLETED`, `FAILED`, `CANCELED`, `REJECTED` never notifies.
- Any later state change notifies exactly like a task started in Taskbay.

## D-14. Visibility and ownership of discovered tasks

Tracked and discovered tasks have `skill_id = null`. Tracked tasks are owned by nobody until claimed (tracking is not claiming). They appear in the Inbox under "Needs you" when waiting, like any task. Workflow actions (claim, assign, due time, notes) work unchanged.

## D-15. Track re-reads the task from the agent

`POST …/track` takes only a task id and tenant. The server calls `GetTask` itself and validates the result; it never stores content supplied by the browser. Browse rows are display data only.

## D-16. Hosting profiles are a first-class requirement

Every task works in all three profiles in [ARCHITECTURE.md "Hosting profiles"](ARCHITECTURE.md#hosting-profiles): **dev** (`npm run dev`, `npx agent-taskbay`: embedded PGlite, one process, embedded workers), **self-hosted** (PostgreSQL, one or more app instances, optional separate workers), and **enterprise / SaaS** (PostgreSQL, OIDC, several instances and worker processes, many organizations). No task may keep state in process memory, assume one instance, bypass `organization_id` scoping, or require a migration an older running instance cannot tolerate.

## D-17. Push notification verification: SDK finding

Read from `node_modules/@a2a-js/sdk/dist/server/index.js` (`DefaultPushNotificationSender`): the SDK sender does **not** sign JWTs and has no JWKS. It sends `Authorization: <scheme> <credentials>` from the registered `authentication`, or else `X-A2A-Notification-Token: <token>`. Taskbay's current per-registration bearer token is exactly what SDK-based agents support. Signed-JWT verification is therefore not built in this plan; it becomes roadmap work (T-23) unless the spec research in T-21 shows non-SDK agents commonly need it.

## Related

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [README.md](README.md)
