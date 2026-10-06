# Approval request extension (v1)

> For agent authors: how to ask a human reviewer to approve one exact action, and what you can rely on when they do. The agent proposes; it has no authority to decide.

- **URI:** `https://extensions.allsrc.dev/agent-taskbay/approval-request/v1`
- **Media type of the request part:** `application/vnd.agent-taskbay.approval-request+json`
- **Status:** defined by this project only; not an A2A standard. Follow-up work is open ([#15](https://github.com/allsrc/agent-taskbay/issues/15), [#16](https://github.com/allsrc/agent-taskbay/issues/16), [#17](https://github.com/allsrc/agent-taskbay/issues/17)).

## What you must supply, and what Agent Taskbay does

| The agent supplies | Agent Taskbay supplies |
| --- | --- |
| The URI in its card's `capabilities.extensions` | A pending approval request visible in the inbox, with notifications |
| The request in its `INPUT_REQUIRED` status message | Reviewer authorization, expiry, an exact-revision decision and an audit trail |
| **Honoring the outcome**: acting only on the approved action, and ideally verifying the digest it receives | Sending the approved action to the agent once |

Agent Taskbay cannot stop an agent from acting without approval, and a person can still reply to the task in the chat composer while a request is open
([#16](https://github.com/allsrc/agent-taskbay/issues/16) tracks an optional "approval required" policy). An approval is a record and a trigger, not a lock.

## Request

In the `INPUT_REQUIRED` status message, include a data part with the approval media type:

```json
{
  "data": {
    "title": "Delete the staging cluster",
    "summary": "Removes all staging nodes and volumes.",
    "risk": "high",
    "expiresInSeconds": 3600,
    "action": { "kind": "send_message", "text": "Approved. Delete the staging cluster." }
  },
  "mediaType": "application/vnd.agent-taskbay.approval-request+json"
}
```

| Field | Required | Rules |
| --- | --- | --- |
| `title` | yes | Non-empty after trimming, at most 300 characters. |
| `summary` | no | At most 4,000 characters. Default empty. |
| `risk` | no | `low`, `medium` (default) or `high`. |
| `expiresInSeconds` | no | A finite number. Clamped to between 300 (5 minutes) and 604,800 (7 days). Default 86,400 (24 hours). |
| `action` | yes | One of the two shapes below. |

`action` is either:

- `{ "kind": "send_message", "text": "<1-20000 chars>", "data": { ... } }` (`data` optional, an object of at most 64 KB). On approval the `text` is sent as the reply; `data` is passed in the reply's `metadata.decision`.
- `{ "kind": "send_data", "form": { ... }, "values": { ... } }`. `form` is a definition in the [structured-form subset](structured-form.md) (at most 64 KB) and `values` must validate against it. On approval `values` is sent as one `application/json` data part.

The whole part may be at most 128 KB of JSON. Scope (agent, tenant, skill, task) always comes from the task. The part cannot name an assignee, reviewer, policy, status or another task; such fields are not read.

## What happens

1. After the observation is stored, Agent Taskbay looks at the task's **latest agent message that carries the input request** (a status message of an `INPUT_REQUIRED` task). If it contains a valid approval part, a **pending** request is opened. The first valid part in the message wins.
2. The agent must advertise the URI in its stored card. The check reads the latest stored card snapshot, so load the catalog (`GET /api/agents`) after registering the agent ([negotiation rules](README.md#negotiation-rules)).
3. Validation happens before anything is written. A malformed, over-limit or non-advertised request is ignored and the message stays ordinary content; it never fails the observation.
4. The request key is `agent:<local task id>:<message id>:<first 16 hex characters of the action digest>`. A replay of the same message opens nothing new. A **changed** request (different message or different action) creates a new request, and the older open request on that task is marked `superseded`: only one approval is live per task. An existing request is never edited by the agent.
5. The request has no requester (`requesterUserId` is `null`) and its audit entries record actor type `agent`. It uses the default policy: all outcomes allowed, separation of duties on, no assignee.
6. A reviewer decides it. Only authenticated people with the `operate` permission for that agent (and skill) can: they may **approve**, **edit then approve**, **reject**, **request changes** or **delegate**. A decision binds to one revision and its digest. See [Approvals and ownership](../../guides/approvals-and-ownership.md).
7. On approval (or edit-then-approve) Agent Taskbay sends the action **once** to the agent, as a message on the same task and context, via the normal command path. Rejecting or requesting changes sends nothing.

## What the approved message carries

The message's `metadata.approval` identifies exactly what was approved so a cooperating agent can verify it:

```json
{
  "approval": {
    "requestId": "<uuid>",
    "decisionId": "<uuid>",
    "revision": 1,
    "revisionDigest": "<sha-256 hex of the approved action>"
  }
}
```

The digest is the SHA-256 (hex) of the canonical JSON, with object keys sorted at every level, of `{ kind, text, data }` (`data` is `null` when absent) for `send_message` or `{ kind, form, values }` for `send_data`, so an agent can recompute it from what it receives. A published verification contract and "executed as approved"
evidence are not done ([#17](https://github.com/allsrc/agent-taskbay/issues/17)); until then, whether the agent checks the digest is the agent's choice.

Agent Taskbay records an execution for each approval and shows the task state it later observed. This is correlation, not proof that the agent did exactly what was approved.

## Limits and failure modes

| Situation | Result |
| --- | --- |
| Extension not advertised, or card never discovered | The part is shown as ordinary data; no request is opened |
| Invalid title, risk, action, form or values, or part over 128 KB | Same: ignored |
| Task not `INPUT_REQUIRED`, or the part is in an older message | No request |
| Task finished before a decision | The request becomes `superseded`; a decision attempt answers `409` and authorizes nothing |
| Not decided before `expiresAt` | The request becomes `expired`; deciding answers `409` |
| Agent sends a new request | The old one is `superseded` |
| Reviewer sets a different action | The approved revision is the edited one; its digest differs from what the agent proposed |

- One live approval per task; there is no queue of requests per task.
- Only `send_message` and `send_data` actions exist. Approving cannot run a tool or change the agent's configuration.
- Not every A2A runtime exposes human-approval pauses in the same way. Adapting to an agent framework's own approval mechanism (for example ADK) is future work ([#18](https://github.com/allsrc/agent-taskbay/issues/18)). Approvals are not yet mapped to AG-UI interrupts ([#20](https://github.com/allsrc/agent-taskbay/issues/20)).
- Proposing the extension to the A2A project: [#19](https://github.com/allsrc/agent-taskbay/issues/19).

Try it: the `showcase` and `approver` agents in `npx agent-taskbay demo-agent` send this request. Sending the showcase agent the message `approve` produced a pending request titled "Delete the staging cluster" with risk `high` and no requester when tried against a development server.

## Further reading

- [Decision record: agent-originated approvals](../../archive/adr/0023-agent-originated-approvals.md)

## Related

- [Approvals and ownership](../../guides/approvals-and-ownership.md)
- [HTTP API: approvals](../http-api.md#approvals)
- [Extensions overview](README.md)
- [Human in the loop](../../concepts/human-in-the-loop.md)
