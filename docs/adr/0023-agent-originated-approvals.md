# ADR 0023: Agent-originated approval requests

- Status: Accepted
- Date: 2026-10-05
- Requirements: HITL-006, HITL-003, HITL-004, SEC-004, AUD-001

## Context

`HITL-006` asks that an agent can open an approval request itself, not only an operator on its behalf (ADR 0015). The A2A
specification gives an interrupted task (`INPUT_REQUIRED`) no structure for a request and, since §7.6.4, says an interrupted
state is a coordination signal rather than an authorization grant: the implementation or extension must define the authorized
operation and check it at use. Other frameworks show the failure modes: a peer able to supply the approval for itself
(ADK's confirmation forgeable by an A2A peer) and approvals bound to a task id instead of the exact operation (published
"loopjacking" attacks on LangGraph Agent Server and others). ADR 0015 already binds an approval to an exact digest, consumed once.

## Decision

- **Opt-in extension.** The Agent Card advertises `https://a2a-ops.dev/extensions/approval-request/v1`. Without it the part is
  ignored and stays ordinary message content.
- **Carrier.** In the agent's `INPUT_REQUIRED` status message, a data part of media type
  `application/vnd.a2a-ops.approval-request+json`: `{title, summary?, risk?, expiresInSeconds?, action}` where `action` is a
  `send_message` or `send_data` action exactly as in ADR 0015. Scope (agent, tenant, skill, task) comes from the task row; the
  part cannot name an assignee, a reviewer, a policy, a status or another task, and any such field is not read.
- **Where it runs.** After an observation is stored, in the same transaction: if the task is `INPUT_REQUIRED` and its latest
  status message carries a valid request from an advertising agent, a pending decision request is opened. All validation
  (shape, then the same `validateAction` a person's proposal passes) happens before any write, so an invalid or conflicting
  request never disturbs the observation; it stays ordinary content.
- **Idempotent and immutable.** The request key is `agent:{task}:{message id}:{action digest}`. A replay opens nothing new.
  An agent that changes what it asks, even in a message with the same id, produces a new key and therefore a new request,
  which supersedes the open one (one live approval per task); an existing request or revision is never mutated by the agent.
- **No authority.** The request has no requester, its first revision is authored by `agent`, and its audit facts have actor
  type `agent`. Only authenticated reviewers decide it, with the same rules as any request (operate grant, expiry,
  exact revision, one-time execution). The agent proposes a lifetime that the console bounds to 5 minutes through 7 days
  (default 24 hours). Separation of duties has no one to exclude, so any eligible reviewer may decide.
- **Visibility.** Reviewers are notified like any request. The review page says the agent opened it and that the agent cannot
  decide it; the audit trail says "The agent". The inbox and approval lists need no change.
- **Execution.** Unchanged from ADR 0015, including the `metadata.approval` identity (request, decision, revision, digest)
  on the approved message so a cooperating agent can verify and echo it.

## Not decided here (tracked)

- Replies that skip an open request through the composer, command API or AG-UI, and an "approval required" policy: #16.
- The agent-side digest-echo contract and "executed as approved" evidence: #17.
- Reading ADK's own pause shape as a recognized pattern: #18. Publishing the extension upstream: #19. AG-UI interrupts: #20.

## Consequences

- Agents that follow the extension get a real, auditable approval step with no new authority; a hostile agent can at most create a
  pending request that a person reads and may reject. A flood of requests is bounded by one live request per task, the per-task
  message size and the existing rate limits on observation.
- The part is only read from the latest input request, so a request in an old message cannot reopen itself.
- The trust boundary is unchanged: the console proves what was approved and sent, not what the agent then does.
