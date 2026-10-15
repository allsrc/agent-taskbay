# UI design

> Who this is for: anyone implementing a task with a UI section. You will have, per screen, what changes, the exact labels, the states to handle, and the rules to follow.

Wireframes are layout intent, not pixel specs. Build them from existing primitives; take colors only from semantic tokens.

## Rules

1. Tokens only (`bg-card`, `text-muted-foreground`, `text-brand-text`, tones `brand | success | warning | danger | info | neutral`). No hex, `oklch()` or palette classes.
2. Reuse: `Page`, `MasterDetail`, `ListPane`, `ListRow`, `ListStatus`, `InfoCard`, `DefinitionList`, `Callout`, `Pill`, `Chip`, `Eyebrow`, `FilterChips`, `ResponsiveDialog`, `Button`, `EmptyState`, `StateChip`. Navigating buttons use `buttonVariants` on a link.
3. Phone width: nothing scrolls sideways; detail screens keep the back button (`parentOf` in `components/app-shell.tsx`); dialogs use `ResponsiveDialog`.
4. Every async action shows a busy state, a success toast and an error message that names what failed and what to do. No silent failures.
5. Agent-supplied strings (errors, titles, messages) render as text through the existing safe renderers. They never choose a label, a color or a link target.
6. Copy uses the vocabulary in [DECISIONS.md D-04](DECISIONS.md#d-04-vocabulary). Sentence case. No exclamation marks.
7. Each state has a design: loading, empty, error, disabled, and long-text wrapping.
8. Keyboard: all new controls reachable and operable; dialogs trap focus (the primitives do this); buttons have names.

## Agent page

File: `app/agents/[agentId]/page.tsx`. Two new cards and one changed card, in the existing two-column grid.

```text
┌ Task discovery ───────────────────────────────┐ ┌ Connection ──────────────────────────────┐
│ Mode  (•) Browse only  ( ) Automatic  ( ) Off │ │ Binding          JSON-RPC                │
│ Browse only: people with access to the whole  │ │ Interface        https://…/a2a           │
│ agent can look at tasks other systems started │ │ Protocol         1.0                     │
│ and choose to track them. Nothing is stored   │ │ Tenant           (default) ▾             │
│ until a task is tracked.                      │ │ Extensions       2 negotiated · 1 ignored │
│ [ Browse tasks on this agent ]                │ │ Required         ✔ all supported         │
│                                               │ └──────────────────────────────────────────┘
│ Automatic only: History to include [ 7 ] days │
│ Last checked 2 min ago · 14 found             │
│ ⚠ Paused: reached 5,000 discovered tasks.     │
└───────────────────────────────────────────────┘
```

- **Task discovery** (T-10). Radio group "Mode": **Browse only** (default), **Automatic**, **Off**, with one sentence under each. Admin only; others see it read-only. The mode options above the deployment cap (`A2A_TASK_DISCOVERY`) are disabled with `This deployment allows up to <cap>.` The button **Browse tasks on this agent** shows for people who may browse (operate on the whole agent) and opens the browse dialog (T-26); it is hidden in mode Off. The history and status lines appear only in Automatic: `Checked 2 min ago · 14 found`, `Not checked yet`, a `warning` Callout for a paused reason. If the agent does not support listing tasks: `This agent does not support listing tasks, so browsing and automatic discovery cannot find anything.`
- **Connection** (T-18). Read-only `DefinitionList`. "Extensions" shows counts; expanding lists each URI with `negotiated`, `ignored` or `required, not supported` pills. A required, unsupported extension also shows a `danger` Callout (T-06): "This agent requires an extension Taskbay does not support. Sending is blocked." with an admin-only switch "Allow sending without it (audited)".
- **Capabilities** card (existing). "Extended card" row becomes a button "Fetch" for admins when the card advertises it (T-17); after a fetch show `Fetched 3 min ago` and a "Refresh" action. Failure states: `Not configured on this agent` (neutral), `Fetch failed` (danger, with retry).

## Browse agent tasks dialog

Opened from the agent page (T-26). Built with `ResponsiveDialog` (full screen on a phone).

```text
Tasks on Billing agent                                       [x]
Live from the agent. Nothing is stored until you track a task.
Status [ Needs input ▾ ]   Context [ paste a context id…   ]   [ Track by task id ]
┌──────────────────────────────────────────────────────────────┐
│ Reconcile invoices                       ● needs input       │
│ 3f9a2c1d · context 77ab12cd · updated 4 min ago              │
│ “Which ledger should I use?”                    [ Track ]    │
├──────────────────────────────────────────────────────────────┤
│ Fetch statements                         ● working           │
│ 9c01aa42 · context 77ab12cd · updated 1 h ago                │
│ Tracked                                         [ Open ]     │
└──────────────────────────────────────────────────────────────┘
                                       [ Previous ] [ Next ]
```

- Rows show the agent's task id (first 8 chars), context, state (`StateChip`), age, and a one-line status message snippet rendered as plain text, truncated to 120 characters, in quotes. Agent text never changes labels or tones.
- **Track** runs the track call, shows a busy state on the row, then the row becomes "Tracked" with **Open** (goes to the task page). Failure shows the T-04 component inline on the row.
- **Track by task id** opens a small field for a task id (and tenant if the agent advertises tenants) for tasks the person already knows about.
- Filters: status (any, needs input, working, finished), context id. Paging uses the agent's `nextPageToken`; **Previous** keeps a stack of tokens. Page size 25.
- States: loading skeleton; empty "The agent returned no tasks for this filter."; unsupported "This agent does not support listing tasks."; permission "You need access to the whole agent to browse its tasks." (for skill-scoped people the button is not shown); error with retry. A short note at the top when the agent has several tenants: a tenant selector.
- Keyboard: rows are not clickable as a whole; **Track** and **Open** are buttons with names that include the task title.

## Connect agent dialog

File: `components/agents/connect-agent-dialog.tsx` (T-10). On the confirm step add a short notice above **Connect**:

> Taskbay will be able to list the tasks on this agent using this agent's credentials. People with access to the whole agent can look at them and choose to track them. Nothing is stored until a task is tracked. You can change this on the agent page.

No checkbox: the default is Browse only. When the deployment cap is `off`, show instead: "Task discovery is turned off for this deployment."

## Tasks list and task page

Files: `app/tasks/layout.tsx`, `app/tasks/[taskId]/page.tsx`.

```text
Filter:  All  Active  Needs you  Done  Mine  Overdue  Unassigned  Discovered
┌──────────────────────────────────────────────────────────────┐
│ Reconcile invoices                          ● working        │
│ 3f9a2c1d · Billing agent · 4 min ago                         │
│ [Discovered]                                                 │
├──────────────────────────────────────────────────────────────┤
```

- New filter chip **Discovered** (`origin=discovered`; tasks someone tracked or automatic discovery found). The empty state of the Tasks list gains a line "Don't see a task another system started? Browse an agent's tasks" linking to the agents list. It composes with the existing state filters (T-11, T-13).
- Row: a `neutral` `Pill` "Discovered" under the metadata line.
- Task page header: a `Callout` (tone `info`, dismissible per task in `localStorage`, wrapped in try/catch) for discovered tasks: "Started outside Taskbay. You can answer it, send it more input or cancel it here." For a tracked task, add "Tracked by <name> on <date>." (T-11)
- **Context** section (T-14): "Other tasks in this context" list, each a link with `StateChip`, hidden when there are none.
- **Related** section (T-19): "Related tasks" list with direction labels `References` and `Referenced by`, `StateChip` each. Action "Cancel this and related" (T-20) opens the dialog below.
- **Agent history** action (T-22): a ghost button "Load agent history" in the timeline header. After loading, a divider labels sections: "What Taskbay received" and "History the agent returned".

### Cancel with related dialog (T-20)

```text
Cancel this task and related tasks
Taskbay cancels each one separately. The agent decides whether it stops.
 [x] Reconcile invoices (this task)            working
 [x] Fetch statements                          working
 [ ] Notify finance      You can't cancel this task (needs someone with access)
                                           [Back]  [Cancel 2 tasks]
```

After confirming, each row shows its own result (`Canceled`, `Agent refused: not cancelable`, `Failed`). Nothing cascades without the checkbox.

## Chat

Files: `components/chat/*`, `lib/conversations.ts`.

- **Discovered conversations** (T-11). Title falls back to the task's `title`, then the first message of any role, then `Task <first 8 of id>` instead of the agent name. A `neutral` pill "Discovered" appears next to the title. The first timeline row is a muted line "Started outside Taskbay" with the task's creation time, since there is no user message.
- **Composer target** (T-11, T-15). When the target is a working task, the placeholder reads "Send more input to the running task. The agent decides whether to use it." The target picker shows `StateChip` per task, and a skill-routing agent never overrides a discovered task's skill (see T-11).
- **Steering outcome chip** (T-15). Under a user message sent to a working task, a small `Pill`:

  | Outcome | Pill | Text |
  | --- | --- | --- |
  | `delivered` | neutral | Delivered |
  | `responded` | success | Agent responded |
  | `refused` | danger | Agent refused: <kind label> |
  | `waiting` | neutral | Waiting for a response |

  `waiting` becomes "No response yet" after 60 s, with no other change.
- **Restart with this instruction** (T-16). In the message actions of a user message sent to a working task: "Stop and restart with this". Opens a `ResponsiveDialog`:

  ```text
  Stop and restart with this instruction
  1. Cancel "Reconcile invoices"   (the agent decides whether it stops)
  2. Start a new task in this conversation with your instruction, referencing the old one.
  Partial work may or may not be kept. Taskbay cannot tell.
                                        [Back]  [Cancel task, then start]
  ```

  Step 2 runs only if step 1 succeeds. Progress shows both steps with their results. A refusal at step 1 leaves everything as it was and offers "Send as extra input instead".

## Command errors (everywhere a send or cancel can fail)

Used by chat, task page and any cancel button (T-04). One shared component, `CommandError`, takes `{ kind, message }` and renders a `Callout`. Only `kind` picks copy; `message` (from the agent) is shown below as quoted, truncated text.

| `kind` | Tone | Copy |
| --- | --- | --- |
| `task_not_found` | warning | The agent no longer knows this task. Start a new one. |
| `task_not_cancelable` | info | This task can no longer be canceled. Its current state is shown above. (The page refreshes the task.) |
| `unsupported_operation` | warning | This agent does not support that action. |
| `content_type_not_supported` | warning | The agent does not accept that kind of content. Try text, or another file type. |
| `extension_required` | danger | The agent needs an extension Taskbay does not support. See the agent page. |
| `version_not_supported` | danger | The agent does not support this protocol version. See the agent page. |
| `invalid_request` | warning | The agent rejected the request as malformed. |
| `task_terminal` (from Taskbay) | info | This task is finished. Start a new task in the same conversation. (Button: **Start new task**) |
| `uncertain` | warning | Taskbay can't tell whether the agent received this. It will not resend automatically. Check the task before trying again. |

## Inbox and notifications

No layout change. Tracked and discovered tasks that need a person appear under **Needs you** with the same "Discovered" pill. Only tracked or automatically discovered tasks can appear here; browsing alone never creates inbox items. Notification text for them says "A task started outside Taskbay needs input" (T-09).

## Settings

No new settings page. The only global control is `A2A_TASK_DISCOVERY` (the highest allowed mode). The agent page shows it as a disabled-option explanation.

## States checklist for every new component

| State | Required |
| --- | --- |
| Loading | skeleton or spinner with a label |
| Empty | explanation and next step |
| Error | what failed, retry, no raw stack |
| Disabled | reason in text or tooltip |
| Long text | truncates or wraps; never overflows the pane |
| Phone width | usable at 360 px |
| Dark theme | uses tokens only |

## Related

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DECISIONS.md](DECISIONS.md)
- [README.md](README.md)
