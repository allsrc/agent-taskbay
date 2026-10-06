# Approval request extension (v1)

URI: `https://extensions.allsrc.dev/agent-taskbay/approval-request/v1`

An agent that advertises this extension can ask a human reviewer to approve an exact action. The agent proposes; it has no authority to
decide.

## Request

In the agent's `INPUT_REQUIRED` status message, include a data part with media type
`application/vnd.agent-taskbay.approval-request+json`:

```json
{
  "title": "Send the quarterly report",
  "summary": "Emails the report to the finance list.",
  "risk": "medium",
  "expiresInSeconds": 3600,
  "action": { "kind": "send_message", "text": "Approved. Send the report." }
}
```

`summary`, `risk` and `expiresInSeconds` are optional. `action` is `{ kind: "send_message", text, data? }` or
`{ kind: "send_data", form, values }`, exactly as defined for
person-proposed decisions ([ADR 0015](../adr/0015-decision-aggregates.md)). The scope (agent, tenant, skill, task) comes from the task;
the part cannot name an assignee, reviewer, policy, status or another task, and any such field is not read.

## Behavior

- After the observation is stored, if the task is `INPUT_REQUIRED` and its latest status message carries a valid request, the console
  opens a pending decision. Validation happens before any write, so an invalid request stays ordinary message content.
- The request key is `agent:{task}:{message id}:{action digest}`, so a replay opens nothing new. A changed request produces a new one
  that supersedes the open request (one live approval per task); an existing request is never mutated by the agent.
- The request has no requester and its audit facts carry actor type `agent`. Only authenticated reviewers decide it, under the same
  rules as any request: operate grant, expiry, exact revision, one-time execution. The requested lifetime is bounded to between 5 minutes
  and 7 days (default 24 hours).
- On approval, the console sends the action once, bound to the approved revision. The approved message carries `metadata.approval`
  (request, decision, revision and digest) so a cooperating agent can verify and echo it.
