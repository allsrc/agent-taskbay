# A2A workflow gap analysis and plan

> Who this is for: maintainers and contributors deciding what to build next. You will have every A2A workflow (WF-01 to WF-74) checked against what Agent Taskbay does today, the gaps ranked, a design for each gap worth closing, and a phased plan with test and documentation commitments.

Status: **proposal**. Nothing here is implemented yet. Compare against `main` at commit `a52de4c`. Decisions taken after this analysis: `auth-required` (G4) is roadmap work, not part of the build; task discovery (G5) defaults to **browse and track** (nothing stored until a person tracks a task), with automatic discovery as an opt-in mode; the A2A error names were checked against `@a2a-js/sdk` 1.3.0.

## How this was produced

I read the code paths that carry each workflow, not only the docs: `src/lib/gateway.ts` (the SDK boundary), `src/server/application/services/*` (command dispatch, observation, subscription, reconciliation, push), `src/server/adapters/a2a/*`, the `/api/agents/*` and `/api/tasks/*` routes, and the chat and task screens. Nothing was run, so every verdict is "by reading". Rows marked **Unverified** need a test before anyone relies on the verdict (see [Phase 0](#phase-0-conformance-harness-first)).

## What Taskbay is, which decides what counts as a gap

The reference describes a client, a server and a platform. Taskbay is the **human-facing A2A client** plus a durable record. It does not run agents and it is not an orchestrator ([Overview](../concepts/overview.md)). So:

- Sections 2–13 of the reference are in scope where Taskbay is the **client**, and where Taskbay acts as the **server for its own users** (WF-61 to WF-66).
- Section 9 (multi-agent) and section 14 (things A2A does not guarantee) are mostly **platform** concerns. Taskbay should *observe and assist*, never silently orchestrate.
- Verdicts: **Done**, **Partial**, **Gap**, **By design** (deliberately not done, with the reason), **Unverified**.

## Coverage at a glance

| Area | Workflows | Done | Partial | Gap | By design | Unverified |
| --- | --- | --- | --- | --- | --- | --- |
| Discovery and connection | WF-01 to 04 | 01, 02, 04 | | 03 | | |
| Basic messages | WF-05 to 10 | 05, 06, 07, 08, 09 | 10 | | | |
| Task lifecycle | WF-11 to 17 | 11, 12, 13, 15, 17 | 14 | 16 | | |
| Retrieval and query | WF-18 to 23 | 18, 20, 22, 23 | 19, 21 | | | |
| Streaming | WF-24 to 31 | 26, 27, 28, 29, 30, 31 | | | 24 | 25 |
| Push | WF-32 to 36 | 32, 33 | 36 | | 34, 35 | |
| Follow-up and steering | WF-37 to 42 | 37, 39, 42 | 38, 40, 41 | | | |
| Multi-agent | WF-43 to 49 | | 43, 44, 47 | 45, 46, 48, 49 | | |
| Data and artifacts | WF-50 to 56 | 50 to 55 | 56 | | | |
| Extensions and negotiation | WF-57 to 60 | 57, 58 | 60 | 59 | | |
| Security | WF-61 to 66 | 61, 62, 63, 64, 65 | 66 | | | |
| Errors | WF-67 to 74 | 67, 69, 70, 71, 73, 74 | 68 | 72 | | |

## The gaps, ranked

| ID | Gap | Workflows | Why it matters | Priority |
| --- | --- | --- | --- | --- |
| G1 | Remote A2A errors are all treated as "uncertain" | WF-14, 67, 68, 72 | A definite rejection (task not found, not cancelable, unsupported) blocks the user with "automatic resend is disabled" | P1 |
| G2 | Required extensions are not checked | WF-59 | A mandatory extension we do not understand is silently ignored, so the agent misbehaves | P1 |
| G3 | Terminal tasks accept follow-ups at the API; cancel has no precheck | WF-17, 72 | Spec says a terminal task cannot be restarted; we forward the request and get an opaque failure | P1 |
| G4 | `auth-required` is display-only | WF-16, 38 | The user is told to authorize and has no way to say "done", and recovery waits for a 15 s poll ([#1](https://github.com/allsrc/agent-taskbay/issues/1)) | Roadmap |
| G5 | Tasks that exist on the agent but not in Taskbay are never discovered | WF-19, 43, 44 | Reconciliation lists the agent's tasks and then drops every one it did not create. Browse and track lets people steer work an automated process started. Automatic discovery is opt-in. | P2 |
| G6 | Extended Agent Card is never fetched | WF-03 | Authenticated callers miss extra skills and capabilities | P2 |
| G7 | No context-aware task views or ListTasks-style filters | WF-10, 19 | A context holds many tasks; the list is flat and only filters by state and ownership | P2 |
| G8 | Steering a running task is possible but unexplained and unmeasured | WF-40, 41 | The user cannot tell if an instruction was accepted, rejected or ignored | P2 |
| G9 | No view of related tasks across agents, no assisted cancel | WF-44, 47, 48, 49 | Parent/child work is invisible; cancelling a parent leaves children running | P3 |
| G10 | Push verification is a shared bearer token only | WF-36 | No JWT/JWKS option, and orphaned configs cannot be listed or cleaned up | P3 |
| G11 | Remote task history cannot be fetched on demand | WF-21 | Only what arrived on the wire is shown; users may mistake it for the agent's full trace | P3 |
| G12 | Negotiated interface, version and tenant are not shown | WF-60, 66 | Hard to diagnose "wrong version/binding/tenant" | P3 |
| G13 | No retention, redaction or purge of stored raw events | section 14 | Already listed in [compatibility](../reference/compatibility.md) as a known limitation | P3 |

"By design" decisions, kept so nobody reopens them without new information:

- **WF-24 `SendStreamingMessage` is not used.** Commands go out as `SendMessage` with `returnImmediately`, and a worker then subscribes to the task. This keeps the outbox/lease model simple and survives a closed browser. Revisit only if an agent is found that cannot be observed this way.
- **WF-34/35 multiple push configs and config management.** Taskbay registers exactly one config per task for itself. Exposing config CRUD to users has no use case. G10 only adds *listing* for self-cleanup.
- **WF-45/46 parallel delegation and agent-to-agent streaming.** An agent calling other agents happens inside the agent. Taskbay will not orchestrate; it only needs to *see* the result (G5, G9).

---

## Workflow-by-workflow check

Evidence is the file that decides the verdict. "Closes" names the gap above.

### Discovery and connection (WF-01 to 04)

| WF | Verdict | Evidence and notes |
| --- | --- | --- |
| 01 Public discovery | Done | `agentCardUrlCandidates` tries `/.well-known/agent-card.json`; interface selection pinned or SDK default (`gateway.ts`). |
| 02 Authenticated discovery | Done | One credential per agent. Card `securitySchemes` are checked for shape only, not used to choose a scheme ([compatibility](../reference/compatibility.md)). Accepted, because the operator chooses the credential. |
| 03 Extended card | **Gap (G6)** | Action `extendedCard` exists in `gateway.ts` but no route or UI calls it; the agent page only shows whether the card advertises it. |
| 04 Capability-based selection | Done | Operator picks the agent and skill. The spec defines no ranking, so none is built. |

### Basic messages (WF-05 to 10)

| WF | Verdict | Evidence and notes |
| --- | --- | --- |
| 05 Stateless reply | Done | `SdkCommandGateway.dispatch` returns `{message}` or `{task}`; a direct message gets a stable local id (`observe-task.ts`). |
| 06 Message creates a task | Done | Same path, task row keyed by remote task id. |
| 07 Blocking | Done | `config.returnImmediately: false` passes through `acceptCommand`; chat has a per-send override. |
| 08 Nonblocking | Done | Default is `returnImmediately: true`, then worker observation. |
| 09 Many messages, one context | Done | Chat reuses the first `contextId` in the conversation. |
| 10 Many tasks, one context | Partial (G7) | Stored and sent correctly; the console shows them in one chat but the Tasks list is flat. |

### Task lifecycle (WF-11 to 17)

| WF | Verdict | Evidence and notes |
| --- | --- | --- |
| 11, 12, 13 States | Done | State set mirrors A2A; notifications on needs-input, finished, failed (`observe-task.ts`). |
| 14 Cancel | Partial (G1, G3) | Button on chat and task page, goes through an idempotent command. No precheck against known terminal state. A refusal from the agent is classified "uncertain" (G1). Not offered from the inbox or list. |
| 15 Input required | Done | Reply box, structured forms, approvals. |
| 16 Auth required | **Gap (G4)** | Timeline shows "In-app credential exchange is not built yet." |
| 17 Terminal is final | Partial (G3) | The chat UI only targets open tasks, so it starts a new task in the same context. The HTTP command API does not enforce it. |

### Retrieval and query (WF-18 to 23)

| WF | Verdict | Evidence and notes |
| --- | --- | --- |
| 18 GetTask | Done | Reconciliation worker, 15 s per open task (`reconcile-task.ts`). |
| 19 ListTasks | Partial (G5, G7) | Used only to refresh tasks we already know (`known.get(...)` drops the rest). Only `contextId`, `status`, `pageSize`, `pageToken` are passed; `statusTimestampAfter` is never set, so every sweep re-reads everything. |
| 20 Pagination | Done | `nextPageToken`, 100-item cap, loop guard. |
| 21 History | Partial (G11) | `historyLength` is a per-send option. No on-demand fetch. The local timeline is Taskbay's own event ledger, which is not the agent's trace. |
| 22 Artifacts | Done | Stored in the artifact store; no remote refetch, so retention follows Taskbay's own policy (G13). |
| 23 Polling | Done | Fallback when the card has no streaming or the stream drops. |

### Streaming (WF-24 to 31)

| WF | Verdict | Evidence and notes |
| --- | --- | --- |
| 24 Streaming start | By design | See above. |
| 25 Repeated status, same state | Unverified | `appendIfAbsent` de-duplicates by source key and turn; repeated same-state updates with different messages should survive. Needs a test. |
| 26, 27, 54 Artifact updates, append, replace | Done | `append` and `lastChunk` are honored in `versioned-task-projection.ts`. |
| 28 Subscribe | Done | `SubscriptionWorker`; the card must advertise `streaming`. |
| 29 Many observers | Done | One upstream subscription per task; many browsers read the committed state (`readTaskFeed`). Better than the spec's model. |
| 30 Reconnect | Done | Exponential backoff to 30 s, plus reconciliation as the backstop. |
| 31 Subscribe to terminal | Done | `observationPaused` stops before subscribing. |

Note on `observationPaused`: it also pauses on `INPUT_REQUIRED` and `AUTH_REQUIRED`, which are non-terminal. That is correct while the agent waits for the user, but an agent that resumes by itself after out-of-band authorization is only noticed by the 15 s poll. G4 covers this.

### Push (WF-32 to 36)

| WF | Verdict | Evidence and notes |
| --- | --- | --- |
| 32 Register webhook | Done | Worker-managed, needs `A2A_PUSH_CALLBACK_ORIGIN`. |
| 33 Async notifications | Done | Webhook route validates the envelope against the task identity, rate-limits, ingests. |
| 34, 35 Many configs, management | By design | One config per task. Only create, get and delete are called; list is never called. |
| 36 Verification | Partial (G10) | Per-registration bearer token, timing-safe compare, rate limit, de-duplication by event digest. No JWT/JWKS option for agents that sign notifications. |

### Follow-up and steering (WF-37 to 42)

| WF | Verdict | Evidence and notes |
| --- | --- | --- |
| 37 Continue input-required | Done | Chat targets the waiting task first. |
| 38 Continue auth-required | Partial (G4) | The user can reply; nothing helps them authorize or signals completion. |
| 39 Follow-up in context | Done | |
| 40 Input to a working task | Partial (G8) | The chat target picker includes working tasks, so the message goes out. Nothing records or explains the agent's response to it. |
| 41 Change requirements | Partial (G8) | Possible by hand (cancel, then a new task with a reference to the old one). No guided path. |
| 42 Human approval | Done | Goes well beyond the protocol (exact-revision, once-only, separation of duties). Known limit: replies can bypass an open request ([#16](https://github.com/allsrc/agent-taskbay/issues/16)). |

### Multi-agent (WF-43 to 49)

| WF | Verdict | Evidence and notes |
| --- | --- | --- |
| 43 Agent calls agent | Partial (G5) | Happens inside the agent. Taskbay sees the child only if the user connected it and the task was created through Taskbay. |
| 44 Parent waits for child | Partial (G5, G9) | `referenceTaskIds` are sent and `referenceLinks` render for tasks Taskbay knows. Children created by an agent are not imported. |
| 45, 46 Parallel, agent-to-agent streaming | By design | Not Taskbay's job. |
| 47 Nested tracking | Partial (G9) | Only through `referenceTaskIds`; no relation model. |
| 48 Distributed cancel | **Gap (G9)** | Cancel acts on one task. |
| 49 Cross-agent failure | **Gap (G9)** | No signal that a parent's failure came from a child. |

### Data and artifacts (WF-50 to 56)

| WF | Verdict | Evidence and notes |
| --- | --- | --- |
| 50 to 53 Parts | Done | `text`, `raw`, `url`, `data`; multiple parts per message. |
| 55 Input and output modes | Done | The composer checks media types against `defaultInputModes`; `acceptedOutputModes` defaults to a broad list. |
| 56 Structured contracts | Partial | Handled by Taskbay's own extensions (forms, approvals, A2UI subset). No generic JSON-schema validation. Correct per spec, since this is optional. |

### Extensions and negotiation (WF-57 to 60)

| WF | Verdict | Evidence and notes |
| --- | --- | --- |
| 57, 58 Discover, use | Done | `negotiateSidebandExtensions` intersects advertised URIs with the ones Taskbay understands. |
| 59 Required extension | **Gap (G2)** | `required` is never read (`server/sideband/extension.ts`). |
| 60 Version and interface | Partial (G12) | Pin or SDK default; the result is not shown to the user. gRPC is refused. |

### Security (WF-61 to 66)

| WF | Verdict | Evidence and notes |
| --- | --- | --- |
| 61 Authenticate to agent | Done | Bearer, API key, OAuth client credentials, mTLS. |
| 62 to 65 Task access | Done | `taskAccessFilter` on every task read; roles and grants per agent and skill; the freshness stream is scoped per principal. |
| 66 Tenant isolation | Partial (G12) | `tenant` is part of task identity. Chat sends `tasks[0]?.tenant`, so a conversation's tenant comes from its first task. Whether a new conversation takes the tenant from the selected interface is **Unverified**. |

### Errors (WF-67 to 74)

| WF | Verdict | Evidence and notes |
| --- | --- | --- |
| 67 Unknown task | Done locally; Partial remotely (G1) | |
| 68 Unsupported operation | Partial (G1) | Push and listing handle it (`PushUnsupported`, `ListTasksUnsupported`). Commands do not. |
| 69 to 71 | Done | |
| 72 Terminal continuation | **Gap (G3)** | `acceptCommandWithin` never checks the state of `input.taskId`. |
| 73 Stream failure | Done | |
| 74 Task failure vs transport error | Partial (G1) | Both end up as "failed" or "uncertain" command states with generic text. |

### Section 14: things A2A does not guarantee

| Item | Who owns it here |
| --- | --- |
| 1 Durable task storage | Taskbay. The database is the product. |
| 2 Checkpoints, 3 crash recovery, 9 steering, 10 next node, 11 memory, 12 scheduling, 16 scaling | The agent. Taskbay can only explain what it observed (G8). |
| 4 Replay of historical events | Taskbay keeps its own append-only ledger; the agent's history is not fetched (G11). |
| 5 Exactly-once | Not provided. Taskbay marks a command "uncertain" after a lost lease and never resends. G1 shrinks the cases wrongly marked uncertain. |
| 6, 13 Global discovery | Not provided. Operator connects agents by card URL. |
| 7, 8, 17, 19 Orchestration, cascade cancel, transactions, compensation | Not provided; G9 only assists. |
| 14 Schema-driven UI | Taskbay's structured-form extension covers the agents that opt in. |
| 18 Approval engine | Taskbay's approval extension. |
| 20 Observability and audit | Audit trail exists. Trace propagation (`traceparent`) is sent. Metrics and export were not checked. |

---

## Designs

Each design follows the existing architecture: a **port** in `src/server/application/ports`, a **service** in `application/services`, an **adapter** in `adapters`, a **runtime** wiring file, then routes and UI. Names below are proposals.

### G1. Classify remote errors (P1)

**Problem.** `CommandDispatcher.runOne` handles three outcomes: `SafeDispatchRetry` (before send), `PermanentDispatchFailure` (local), and everything else becomes `uncertain`. A JSON-RPC or REST error returned by the agent is a *definite* answer, so the request did not execute. Treating it as uncertain disables retries and hides the reason.

**Design.**

1. New `src/server/application/ports/remote-errors.ts`:

   ```ts
   export type RemoteErrorKind =
     | "task_not_found" | "task_not_cancelable" | "unsupported_operation" | "content_type_not_supported"
     | "invalid_agent_response" | "extension_required" | "version_not_supported" | "auth_failed"
     | "rate_limited" | "invalid_request" | "unknown_definite";
   export class RemoteRejection extends Error { constructor(readonly kind: RemoteErrorKind, readonly code: number | string, message: string) { super(message); } }
   ```

2. `SdkCommandGateway` maps the SDK's error (the code already reads `envelopeCode`; also read the REST `status` and error `type`) to `RemoteRejection`. Anything that reached the agent but returned no parseable error stays "uncertain". Network errors after dispatch stay "uncertain".
3. Add a command status `rejected` (a settled terminal status, safe to resend with a new idempotency key) and store `lastError` as `{kind, code}` plus a short fixed message. Remote text is shown as quoted data, never as UI copy ([threat model](../security/threat-model.md): agent text is untrusted).
4. UI maps `kind` to guidance: `task_not_cancelable` shows "This task can no longer be canceled" and refreshes it; `content_type_not_supported` names the offending media type; `extension_required` links to G2.
5. The cancel path treats `task_not_cancelable` as a refresh trigger: run one `GetTask` through the reconciliation port so the user sees the true state.

**Compatibility.** Adding a command status is a stored-shape change: one migration, plus `docs/reference/data-model.md` and `http-api.md`.

**Tests.** Unit: mapping table for JSON-RPC codes and REST statuses. DB: command ends `rejected`, outbox row finished, no resend. HTTP script: fixture agent returns each error.

### G2. Required extensions (P1)

**Problem.** The card can mark an extension `required: true`. `negotiateSidebandExtensions` ignores the flag.

**Design.**

1. Extend discovery output with `requiredExtensions` (advertised, `required`) and `unsupportedRequired` (required and not in `sidebandExtensionUris()`).
2. Compliance report gains an `error`-level issue per unsupported required extension (it stays advisory for registration, as today).
3. `createClient` still builds, but `acceptCommandWithin` refuses sends to an agent with `unsupportedRequired` unless an admin sets a per-agent override "send anyway" (audited). Failure reads `extension_required` and lists the URIs.
4. Agent page shows the negotiated, ignored and required-but-unsupported lists.

**Tests.** `agent-card.test.ts` and `agent-registry.db.test.ts` for the flag; HTTP script for the refusal and the override audit row.

### G3. Terminal-task guard (P1)

**Design.**

- In `acceptCommandWithin`, when `task` is found and its state is terminal: for `send`, reject with `409 TASK_TERMINAL` and a body hint `{ "startNew": { "contextId": "<same context>" } }`; for `cancelTask`, return `409 TASK_TERMINAL` too.
- The local state may be stale. Before rejecting, enqueue one reconciliation read for that task and rely on the stored state only if the read is fresher than 5 s (`task-freshness` already tracks this). If the agent says the task is not terminal, accept.
- Chat already routes around terminal tasks; it only needs to show the error text when the API refuses.

**Tests.** DB: terminal send refused; stale-terminal send allowed after refresh; cancel of terminal refused. Update the HTTP API reference.

### G4. Auth-required (roadmap, supersedes [#1](https://github.com/allsrc/agent-taskbay/issues/1))

**Constraint.** A2A defines the state, not the handoff ([WF-16](#task-lifecycle-wf-11-to-17)). Taskbay must not become a credential broker.

**Design.**

1. **Agent contract (extension).** New extension `…/extensions/auth-request/v1` documented in `docs/reference/extensions/auth-request.md`. The agent's `auth-required` status message carries one `data` part:

   ```json
   { "kind": "auth-request", "title": "Connect GitHub", "authorizeUrl": "https://…", "expiresAt": "…", "scopes": ["repo"] }
   ```

   Without the extension, the existing "reply here to resume" text stays.
2. **Rendering.** An "Authorize" button that opens `authorizeUrl` in a new tab with `rel="noopener noreferrer"`. The URL must be `https`, pass `url-safety` (no private addresses, and the origin allowlist when one is set), and is shown as text beside the button. Taskbay never fetches it, never follows redirects, and never receives the credential.
3. **Resume.** A button "I've authorized, resume": sends a fixed continuation message (`{ "kind": "auth-complete" }` data part) on the same task, through the normal idempotent command, and enqueues an immediate reconciliation read so the user does not wait for the 15 s poll.
4. **Out-of-band resume.** Add a `recheckAt` to tasks in `AUTH_REQUIRED` (every 5 s for the first minute, then the normal 15 s) so an agent that resumes by itself is noticed quickly.
5. **Safety.** Audit `task.auth.opened` and `task.auth.resumed`. Only people with `operate` on that agent/skill see the button. Expired requests render disabled.
6. **Notifications.** Already `task.needs_input` with detail `auth`.

**Tests.** `a2a-shapes.test.ts` for the part; component test for the button states and URL refusal; fixture agent that goes `auth-required` then `working` after a flag flips; HTTP script for resume.

### G5. Discover tasks started elsewhere (P2, on by default)

**Problem.** Reconciliation (`reconcile-task.ts`) calls `ListTasks` and skips unknown ids. Tasks created by another client, or by another agent acting on the user's behalf, never appear.

**Design.**

1. Per-agent setting `taskDiscovery`: `browse` (default: list live, store only what a person tracks), `auto` (background sweep) or `off`, capped by `A2A_TASK_DISCOVERY`. Credentials are shared: an agent's visible tasks are visible *to the credential*, which may be broader than the Taskbay user's grant, so the feature is disclosed at connect time and only whole-agent grants see the results.
2. In the list sweep, unknown tasks are validated with `validateReconciledTask`-style checks (tenant, shape) then created with `source = "imported"`, `skillId = null`, and a `discovered` audit entry. Imported tasks inherit visibility from the agent grant, never from the remote.
3. Use `statusTimestampAfter = lastSyncedAt - skew` so the sweep reads only what changed. Keep a full sweep once an hour as the safety net.
4. UI: an "Imported" badge on the task row and task page, and a filter. Skill-scoped principals do not see imported tasks (no skill can be proven).
5. Cap: at most 200 imports per sweep and 5 000 per agent, with an agent-level "import paused" message.

**Risks.** A hostile agent could flood the list. Caps, the existing 100-per-page limit and per-agent pause cover it. Note that this is the same trust we already extend to a connected agent.

**Tests.** DB: unknown task imported in `context` and `all` modes, ignored in `off`; tenant mismatch rejected; cap behavior; incremental timestamp. Reuse `reconciliation.db.test.ts` fixtures.

### G6. Extended Agent Card (P2)

**Design.**

1. When the card says `capabilities.extendedAgentCard`, an admin action "Fetch extended card" (and a refresh on credential change) calls the existing `extendedCard` operation with the agent credential.
2. Store it as a separate `card_snapshot` kind `extended`; never overwrite the public one. The agent view merges: public skills, then extended skills marked "authenticated".
3. Handle `ExtendedAgentCardNotConfigured` (G1) as a normal "not available" state, not an error.
4. The extended card passes the same safety checks (`assertSafeAgentCard`, size limit, signature verification).
5. Skill routing and grants keep using the public card unless an admin explicitly opts an extended skill in.

**Tests.** Gateway test with a stub; DB test for snapshot kinds; agent page render.

### G7. Context-aware views and ListTasks-style filters (P2)

**Design.**

1. `GET /api/tasks` gains `contextId`, `agentId`, `updatedAfter`, and a cursor option (`after`) alongside `limit`/`offset`. The current `filter` values stay.
2. Task page shows "Other tasks in this context" (same agent, tenant, `remoteContextId`). The tasks list can group by context.
3. Index on `(organization_id, agent_id, tenant, remote_context_id)` if the query plan needs it. Confirm on PostgreSQL before adding.

**Tests.** Route validation, DB filter, a screenshot-free component test.

### G8. Steering a running task (P2)

**What Taskbay can honestly offer.** A2A carries the message; the agent decides. So:

1. When the target is a `WORKING` task, label the composer "Send additional input. The agent decides whether to use it." and record the outcome.
2. **Outcome tracking.** After the send, watch for up to 60 s: a status message or artifact after the user's message is "responded"; a `rejected` command (G1) is "refused by the agent"; otherwise "no visible response yet". Shown as a small chip on the user message. No claims about internal behavior.
3. **Replace instruction.** A guided action, "Stop and restart with this instruction": cancel (with confirmation), then send in the same `contextId` with `referenceTaskIds = [oldTask]`. The two steps stay visible and each is its own idempotent command. If the cancel is refused, the second step does not run.
4. Copy states what is *not* known (whether partial work is kept), per WF-41.

**Tests.** Component tests for the chip states; DB test that the second command depends on the first; HTTP script with a fixture that accepts, ignores and rejects.

### G9. Related tasks and assisted cancel (P3)

**Design.**

1. Relation model: `task_link(from_task, to_task, kind)` with kinds `references` (from `referenceTaskIds`), `same_context`, and `delegated` (optional metadata key an agent can set, documented as an extension, e.g. `…/extensions/task-lineage/v1`, carrying child `{agentUrl, taskId}`).
2. Task page "Related" panel lists links, with state per task.
3. "Cancel this and related": opens a checklist of non-terminal related tasks the user may operate; each cancel is a separate command with its own result row. Nothing cascades automatically, and the dialog says so. If a child belongs to an agent the user cannot operate, it is listed as "needs someone else".
4. Failure attribution (WF-49): when a task fails and a linked child failed earlier, show "Related task failed first". Informational only.

**Why P3.** Without G5 the child is mostly absent; do G5 first.

### G10. Push verification and cleanup (P3)

1. Optional JWT mode: when the agent's push config advertises signed notifications, verify against its JWKS (fetched through the safe fetch, cached, `alg` allowlist, `exp`/`iat` skew limits). Bearer mode stays the default.
2. Use the existing `listPushConfigs` operation in a periodic sweep to delete configs whose registration is `deleted` locally (orphans after crashes).

### G11. On-demand remote history (P3)

A "Load agent history" action on the task page calls `GetTask` with `historyLength`, ingests it as a `reconciliation` event, and labels the timeline: "Taskbay's record of what it received" versus "history the agent returned".

### G12. Show negotiation (P3)

Agent page: chosen binding, interface URL, protocol version, tenant, negotiated extensions. Chat options panel: tenant selector limited to tenants advertised in `supportedInterfaces`.

### G13. Retention (P3)

Out of this plan's scope beyond a pointer. It needs its own design: per-organization retention for `task_event` payloads and artifacts, with audit rows kept. Tracked in [compatibility](../reference/compatibility.md).

---

## Phased plan

Each phase is a set of pull requests that can ship alone. Per [AGENTS.md](../../AGENTS.md), every change updates its docs page, adds tests, and passes `npm run check`.

### Phase 0: conformance harness (first)

Write tests before behavior so every verdict marked **Unverified** becomes known, and every later phase has a scenario to extend.

- Extend the fixture agents in `scripts/` with switchable behaviors: `auth-required`, `extended-card`, `list-with-foreign-tasks`, `required-extension`, `error-codes`, `ignores-input-while-working`.
- One DB-level scenario test per reference scenario A to K (`*.db.test.ts`) using the existing PGlite harness.
- Resolve the Unverified rows: WF-25 (same-state updates) and WF-66 (tenant from interface).
- Output: a table in `docs/reference/compatibility.md` linking each WF to its test.

Exit: all Unverified rows now Done, Partial or Gap, and the coverage table above is regenerated.

### Phase 1: correctness (G1, G3, G2)

Smallest user-visible harm first. G1 lands first because G3 and G8 depend on its `rejected` status.

Exit: no definite remote rejection is shown as "uncertain"; a terminal task is never continued; an unsupported required extension blocks sends.

### Phase 2: human flows (G8)

Exit: a steering message shows what happened to it. (G4, `auth-required`, is roadmap work.)

### Phase 3: visibility (G5, G7, G6, G12)

Exit: tasks created outside Taskbay can appear (opt-in), contexts are navigable, the extended card is available.

### Phase 4: coordination and hardening (G9, G10, G11)

Exit: related tasks are visible and can be cancelled in one assisted step; push verification supports signed notifications.

G13 is a separate design.

## Cross-cutting rules

- **Remote text is data.** Error messages, auth URLs and card fields from agents render through the existing safe renderers and never become instructions or HTML ([threat model](../security/threat-model.md)).
- **Idempotency.** Every new user action (resume, steer, cancel related) is a command with an idempotency key. Nothing is resent automatically after an uncertain outcome.
- **Audit.** New security-relevant actions write an append-only audit row: `task.auth.opened`, `task.auth.resumed`, `agent.extension.override`, `task.import.discovered`.
- **Compatibility.** Stored-shape changes (a command status, `source = imported`, `task_link`, a card snapshot kind) each get a migration and a `docs/reference/data-model.md` update. Pre-1.0 allows this, but note them in the CHANGELOG.
- **Docs to update per gap:** G1 `http-api.md`, `troubleshooting.md`; G2 `connect-an-agent.md`, `compatibility.md`; G3 `http-api.md`; G4 new `extensions/auth-request.md`, `build-an-agent-for-taskbay.md`; G5 `connect-an-agent.md`, `configuration.md`; G6 `connect-an-agent.md`; G7 `use-the-console.md`, `http-api.md`; G8 `use-the-console.md`, `human-in-the-loop.md`; G9 `human-in-the-loop.md`, `data-model.md`; G10 `agent-push-callbacks.md`; and `status-and-roadmap.md` at the end of each phase.

## Resolved questions

1. **G4.** Kept as roadmap. The design above is the starting point.
2. **G5 default.** Browse and track by default; automatic discovery is opt-in; a per-agent mode and a deployment cap.
3. **G1 names.** Verified against `@a2a-js/sdk` 1.3.0: the nine semantic errors plus `RequestMalformedError`, with JSON-RPC codes -32001 to -32009. `InvalidAgentResponseError` means the agent may have executed the request, so it stays "uncertain".
4. **G8 window.** 60 seconds, shown as "No response yet" with no other change.
5. **G9 lineage.** Dropped: related tasks come from `referenceTaskIds` only.
