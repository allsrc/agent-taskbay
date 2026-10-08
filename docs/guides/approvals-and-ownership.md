# Approvals and ownership

> Who this is for: operators, reviewers and administrators who use the console day to day. At the end you can find work that needs you, decide an approval, take ownership of a task, set a due time, and configure where overdue work goes.

Agents ask people for things: input, approval, or just attention. The console turns those into items in one inbox. Approvals are decisions on an exact piece of content. Ownership says who is responsible for a task, independent of what the agent's task state is.

## Before you start

- You need the **operator** or **admin** role, and, for operators, an "operate" grant for the agent. Viewers can read but cannot decide, claim, assign or write notes. Administrators have access to every agent. See [Sign in and roles](sign-in-and-roles.md).
- If you are trying this locally, the [Quickstart](../quickstart.md) gives you an agent that opens an approval.

## Find work: the Inbox

**Inbox** lists tasks and approvals you may see in one list. A badge on the sidebar item shows pending approvals. Pick a view:

| View | Shows |
| --- | --- |
| Needs you (default) | Tasks waiting for input or authorization, and approvals still open |
| Mine | Open tasks assigned to you, and approvals assigned to you |
| Overdue | Open tasks past their due time, and open approvals past their expiry |
| Active | Tasks that are not finished, and open approvals |
| Done | Finished tasks and closed approvals |
| All | Everything you can see |

Filters: **Show** (Everything, Tasks, Approvals) and **Risk** (Any, High, Medium, Low). Each row shows the agent, how long ago it changed, the assignee, an expiry or due time, and "escalated" when it has been escalated. The list loads 30 items at a time with **Load more**. Saved views, free-text search and bulk actions do not exist yet ([#5](https://github.com/allsrc/agent-taskbay/issues/5)). The separate **Approvals** page lists only approvals, with tabs Pending, Needs changes, Assigned, Closed and All.

## Decide an approval

An approval holds one proposed action: a text message to send to the agent, or a set of values for a form the agent defined. The action is stored as a numbered **revision** with a content digest. Your decision applies to the revision you saw. If the revision changes while you look, the console refuses the decision and asks you to review the new one.

Open an approval from the inbox. The page shows the title, risk, who opened it, the expiry, the proposed action with its revision number and a short digest, and a link to the task.

Choose one outcome under **Your decision**:

| Outcome | Rationale | What happens |
| --- | --- | --- |
| **Approve** | Optional | Sends exactly the shown content to the agent, once. A confirmation dialog appears first. |
| **Edit…** | Required | Change the text, or the form values (but never the form itself), then **Approve edited version**. This records a new revision and approves it in one step. The edit must differ from the current content. |
| **Request changes** | Required | Returns it to the proposer. Nothing is sent. A revised proposal puts it back in the queue. |
| **Delegate…** | Required | Hands it to another eligible reviewer. You do not decide it. |
| **Reject** | Required | Closes it. Nothing is sent. |

Rules the server enforces, shown in the UI as a notice instead of buttons:

- **Separation of duties.** By default the person who requested an approval cannot decide it: "The requester cannot decide their own request." Approvals the agent opens have no requester, so anyone eligible can decide them.
- **Assignment.** If an approval is assigned to someone, only that person or an administrator can decide it.
- **Expiry.** Past its deadline an approval can no longer authorize anything. Open a new request from the task if it is still needed. Approvals opened by the console from a task offer expiry choices of 1 hour, 8 hours, 24 hours or 7 days (the server accepts up to 30 days). Approvals the agent opens are clamped to between 5 minutes and 7 days (default 24 hours).
- **Finished tasks.** If the task finishes first, the approval becomes "Superseded".
- **One live approval per task.** A newer request for the same task replaces the open one.
- **Idempotent decisions.** Clicking twice, or retrying after a network error, does not decide twice or send twice.

After you approve, the **Result** card shows the delivery state: "Queued to send to the agent", "Sending to the agent", "Delivered to the agent", "Could not be delivered", or "Delivery outcome unknown — not resent automatically". The last one means the console could not tell whether the agent received the message. It does not retry, because a retry might repeat the action. Check the task before sending anything again.

The page also shows the **Decision record** (who, which revision, when, and the rationale) and every revision. The **Audit** card links to the task's audit trail. Records are append-only.

### Ask for an approval yourself

A person can record an action that needs sign-off even if the agent did not ask. Open a task and choose **Request approval** under **Approvals**. Fill in what needs approval, context for the reviewer, the message (or the agent's form values, when the agent advertises a form), risk, expiry, and optionally an assignee. You cannot decide your own request by default. See [Build an agent for Taskbay](build-an-agent-for-taskbay.md#ask-for-approval) for how agents open them.

## Own a task

Open a task from **Tasks** or the inbox. The **Ownership** card shows the assignee, the due time (or "overdue"), and an "ESCALATED" tag, with the last few ownership events.

| Action | Who can do it |
| --- | --- |
| **Claim** an unowned task | Any operator or administrator with operate access to the agent |
| **Release** your own task | The owner, or an administrator (the button reads "Take away" for an administrator acting on someone else) |
| **Assign** to a person | The owner, or an administrator, or anyone if the task is unowned. The assignee must be able to operate that agent. |
| **Set due** / **Clear** | Same as assign. A due time must be in the future and within one year. |
| **Add note** | Any operator or administrator with access |

Ownership cannot change once the task is finished. Claiming a task owned by someone else is refused ("This task is already owned by someone else."). Ownership is a console concept: it is not sent to the agent.

Internal notes are visible to your team only, up to 4000 characters each, never sent to the agent, and cannot be edited or removed.

## Escalation

An administrator can set where overdue, unfinished work goes. Open **Settings**, then **Escalation**.

1. Choose **Applies to**: "All agents", or one agent. An agent-specific rule overrides "All agents".
2. Choose **Escalate to**: an active operator or administrator.
3. **Save rule**. A rule can be turned off and on later.

How it behaves:

- A worker checks every 15 seconds by default (`A2A_DECISION_SWEEP_MS`, minimum 100).
- When a task has passed its due time and is not finished, the console assigns it to the rule's target, records an "escalated" event, and notifies the target and the previous owner. The "escalated" tag shows on the task and in the inbox.
- Each due time escalates at most once. Setting a new due time re-arms it. The level counts how often it happened.
- If the target cannot operate that agent any more, the original owner keeps the task and the event records no target.
- Without a rule, overdue tasks are only flagged as overdue; nothing moves.
- A task needs a due time to be escalated, whether or not it has an owner.

The embedded worker does these sweeps in the same process as the console. With an external worker they run there ([Running and workers](../operations/running-and-workers.md)).

## When it fails

| Message or symptom | Cause | Fix |
| --- | --- | --- |
| "The requester cannot decide their own request." | Separation of duties | Ask another reviewer |
| "This request is assigned to someone else." | Assigned to another member | Ask the assignee or an administrator, or have them delegate |
| "A newer revision exists; review it before deciding." | The proposal changed while you looked | Reload and review the new revision |
| "A rationale is required for this decision." | Reject, edit, request changes and delegate need a reason | Fill in the rationale |
| "This request has expired." / status Expired | The deadline passed | Open a new request from the task |
| "Policy does not allow this outcome." | The request's policy omitted that outcome | Choose another outcome; policy is set when the request is opened |
| "An edit can change the values but not the form they answer." | You altered the form definition through the API | Edit values only |
| "The delegate cannot operate this agent." | Chosen reviewer has no operate grant | Grant access or pick someone else |
| Buttons are missing | Your role or grants do not allow it. The server decides; hidden buttons are a convenience | Check [Sign in and roles](sign-in-and-roles.md) |
| "This task is already owned by someone else." | Claim on an owned task | Ask the owner or an administrator to release or assign it |
| "The due time must be in the future and within a year." | Invalid due time | Choose a time within that range |
| Task did not escalate | No enabled rule, no due time, the task is finished, or the sweep worker is not running | Check Settings and the worker |

## Limits

- Approval is a decision on content, not a security boundary around the agent. The console sends exactly what was approved; it cannot stop an agent from doing something else.
- Only a "send message" or "send values for a form" action exists. Agents cannot ask for other kinds of action.
- Reviewer policy (allowed outcomes, separation of duties) is set per request. The UI always uses the defaults (all outcomes, separation of duties on); the request API (`POST /api/decisions`) accepts a `policy` object. There is no organization-wide setting.
- An approval does not stop someone from replying to the agent another way. A reply that skips an open request, and an "approval required" policy, are tracked in [#16](https://github.com/allsrc/agent-taskbay/issues/16). The agent-side contract for echoing the approved digest is [#17](https://github.com/allsrc/agent-taskbay/issues/17).
- Escalation moves one level to one target. There are no chains, schedules or working hours.
- Ownership and due time are local to the console. The agent's task state is independent.

## Further reading

- [Decision record: decision aggregates](../archive/adr/0015-decision-aggregates.md)

## Related

- [Notifications](notifications.md): how reviewers learn that something needs them.
- [Build an agent for Taskbay](build-an-agent-for-taskbay.md): how agents open approvals.
- [Sign in and roles](sign-in-and-roles.md): roles, teams, grants.
- [Human-in-the-loop concepts](../concepts/human-in-the-loop.md)
