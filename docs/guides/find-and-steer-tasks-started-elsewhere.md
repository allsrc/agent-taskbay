# Find and steer tasks started elsewhere

> Who this is for: people who use Agent Taskbay with agents that other systems also drive (a pipeline, a schedule, a colleague's client), and administrators who decide how much of that Taskbay shows. You will be able to find such a task, take it over, answer or steer it, and know what is and is not stored.

Agents do not only work for people at a Taskbay screen. A nightly job can start a task, and the agent can stop and ask a question at 3 a.m. Taskbay can show that task to the right people so that someone answers it.

## Before you start

- The agent is connected and reachable ([Connect an agent](connect-an-agent.md)). It must support the A2A `ListTasks` method to be browsed; without it you can still track a task whose ID you know.
- You are an administrator, or an operator with an `operate` grant on the **whole** agent. A grant limited to one skill is not enough, and viewers cannot ([Teams and grants](teams-and-grants.md)).
- Task discovery is not `off` for the agent or for the deployment (`A2A_TASK_DISCOVERY`).

What Taskbay does, in one paragraph: it uses **the agent's own credential** to ask the agent what tasks it has. By default it only does this when you open the list, and it stores nothing. You choose which task to **track**; only then is that one task stored and followed. An administrator can instead switch the agent to **Automatic**, where a worker stores tasks started elsewhere in the background.

## Find a task and track it

1. Open **Agents**, then the agent. In the **Task discovery** card choose **Browse tasks**.
2. Narrow the list with **State** (for example *Needs input*) or **Context ID**. Each row shows the title or ID, the state, how long ago it changed and, in quotes, the first line of what the agent last said.
3. Choose **Track** on the task you want. The row now says **Tracked**; **Open** takes you to the task.
   If you know the ID, paste it under **Track by task ID** instead.

**What you should see.** The task appears in **Tasks** with a **Discovered** tag (and under the **Discovered** filter). If it is waiting on a person, it is also in the **Inbox** under **Needs you**. Nobody is notified about the state it is already in, and it has no owner until someone claims it.

Browsing alone stores nothing. A task you do not track appears nowhere in Taskbay, and nothing from the list is kept after you close it.

## Answer, steer or cancel

A tracked task works like any other. Open it in chat and:

- **Answer** when it needs input: type your reply. It goes to the agent on the same task and conversation.
- **Steer** when it is working: send more input. Taskbay delivers it; the agent decides whether and how to use it. A2A has no live steering, so the agent may ignore it or refuse it. A refusal shows as "This agent does not support that action." and is safe to send again ([When a send or cancel fails](use-the-console.md#when-a-send-or-cancel-fails)).
- **Cancel** from the task page or the chat. The agent may refuse; the task then shows its real state.

A finished task cannot be continued. Use **Start new task** to send the same message as a new task in the same conversation.

## Choose how much Taskbay shows

On the agent page an administrator sets the mode:

| Mode | Effect |
| --- | --- |
| **Browse only** (default) | People with access to the whole agent can browse and track. Nothing else is stored. |
| **Automatic** | A worker also stores tasks started elsewhere. Finished tasks only if the agent updated them in the last 7 days (0 to 90, your choice); at most 500 on the first sweep, 200 on later ones and 5,000 per agent, then it pauses and says so. Tasks waiting on input that the agent updated in the last 24 hours notify people. |
| **Off** | Taskbay never lists the agent's tasks. |

A deployment can lower the highest mode with `A2A_TASK_DISCOVERY` ([recipe](configuration-recipes.md#9-limit-allow-or-turn-off-task-discovery)). The card shows "This deployment allows up to …" for modes it forbids.

Who sees discovered tasks: administrators and people with a whole-agent grant. People with only a skill grant never do. Every tracked task and every change of mode is in the security audit.

## When it fails

| What you see | Cause | What to do |
| --- | --- | --- |
| **Browse tasks** is missing | Your role or grant. Viewers and skill-only grants cannot browse. | Ask an administrator for an `operate` grant on the whole agent. |
| "Task discovery is turned off for this agent." | The agent's mode, or the deployment's `A2A_TASK_DISCOVERY`, is `off`. | An administrator changes the mode or the variable. |
| "This agent does not support listing tasks." | The agent has no `ListTasks`. | Track by task ID, if you have it. |
| "The agent could not be reached." | Network, credential or agent failure. | Check the agent on its page. |
| "The agent returned something Taskbay could not read." | The list or the task was malformed, for another tenant, or a different task than asked. | Report it to the agent's owner. Nothing was stored. |
| "The agent does not have a task with that ID." | The ID is wrong, or the credential cannot see that task. | Check the ID. |
| "Too many requests" | More than 30 browses or 20 tracks in a minute for you and this agent. | Wait a minute. |
| Automatic discovery shows "Paused" | It reached 5,000 discovered tasks for this agent and will store no more. Switching the mode off and on again clears the pause, but it pauses again while the agent still has that many. | Track the tasks you need by hand, or set the agent to Browse only. |
| A task you expected is missing in Automatic mode | It is finished and older than the history window, or the sweep limit was reached. | Browse and track it by hand. |

## Limits

- Pre-1.0. The list shows what the agent's credential can see, which may be more than you are allowed to act on elsewhere; that is why browsing needs whole-agent access.
- Browse pages are the agent's own pages (25 rows), without a total count.
- Tracking records the task as it is now. Changes you make on the agent's side are picked up like any other task's.
- Discovery does not apply to tasks of agents Taskbay cannot list or read.

## Related

- [Connect an agent](connect-an-agent.md#task-discovery)
- [Use the console](use-the-console.md#browse-an-agents-tasks)
- [Approvals and ownership](approvals-and-ownership.md)
- [Notifications](notifications.md#tasks-that-were-started-outside-taskbay)
- [Durable tasks](../concepts/durable-tasks.md#tasks-that-taskbay-did-not-start)
