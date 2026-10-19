# Give people access to agents and skills

> Who this is for: administrators who need operators and viewers to see and use specific agents. You will have a team, its members, and a grant that lets the team work with one skill of one agent, plus a way to check and revoke it.

A new operator or viewer sees nothing. Their role sets the most they may ever do; a grant decides which agents, or which skills of an agent, they may do it on. You give grants in **Administration**, or with the access management API. Administrators need no grants: they see and operate every agent in their organization.

Agent Taskbay is pre-1.0. The screens and API on this page may change between minor versions.

## Before you start

- You are signed in as an `admin`. Only administrators see **Administration** and can call `/api/admin/security`.
- The people already have a membership in your organization, provisioned with `npm run auth:provision` (see [Sign in and roles](./sign-in-and-roles.md#provision-people)). Only enabled memberships appear in the lists.
- The agent is registered and its card has been discovered. The skill list in **Agent access** comes from the agent's stored card. If it shows only **Whole agent**, open the agent on the **Agents** page so its card loads.
- For a skill-only grant that people can use to send work, the agent must advertise the skill-routing extension `https://extensions.allsrc.dev/agent-taskbay/skill-routing/v1` and list the skill id in its card. See the [skill routing reference](../reference/extensions/skill-routing.md). Without it, only whole-agent grants let people send.

## How roles and grants combine

A grant names a recipient, an agent, an optional skill, and a permission. The recipient is everyone in the organization, one person, or one team.

| Role | With a `Read` grant | With a `Read and operate` grant | With no grant |
| --- | --- | --- | --- |
| `admin` | Everything (grant not needed) | Everything (grant not needed) | Everything in the organization |
| `operator` | Sees the agent or skill and its tasks | Also sends messages, replies, cancels, claims and assigns tasks, and decides approvals | Nothing: empty catalog, `404` on the agent's tasks |
| `viewer` | Sees the agent or skill and its tasks | Same as `Read`. A viewer never operates, whatever the grant says. | Nothing |

Grants add up. A person gets the union of their own grants, their teams' grants, and the organization-wide grants. A whole-agent grant covers every skill of that agent. A skill grant covers only that skill.

Approvals follow the same rule. Deciding an approval on a task that belongs to a skill needs `operate` on that skill.

The rules are in [`access-policy.ts`](../../src/server/application/services/access-policy.ts) and tested in [`scoped-security.test.ts`](../../src/server/adapters/auth/scoped-security.test.ts) and [`scoped-security.db.test.ts`](../../src/server/adapters/db/scoped-security.db.test.ts).

## Example: give the Payments team operator access to the refunds skill

In this example the agent is named "Billing agent" and has a skill named "Refunds". Two operators, Ada Lovelace and Alan Turing, should send refund requests to it, and nothing else.

### Create the team

1. Open **Administration**, then **Teams**.
2. In **New team name**, type `Payments`.
3. Select **Create team**.

### Add members

1. On the `Payments` card, open **Add a person…** and select `Ada Lovelace (operator)`.
2. Select **Add**.
3. Repeat for `Alan Turing (operator)`. **People** then lists both with the team.

Each member appears as a row such as `Payments · Ada Lovelace`. Adding the same person twice has no effect.

### Grant the skill

1. In the grant form, set the recipient to `Team: Payments`. The other choices are `Everyone in organization` and each person by name.
2. In **Choose agent**, select `Billing agent`.
3. In the scope list, select `Refunds`. Leave it on **Whole agent** to grant every skill.
4. In the permission list, select **Read and operate**. Select **Read** instead for look-only access.
5. Select **Grant access**.

The grant appears as a row: `Payments · Billing agent · refunds · operate`. The third field is the skill id, or `whole agent`.

### Do the same through the API

The **Administration** forms call `POST /api/admin/security`. You can send the same bodies from a browser session. A script must send the session cookie and, in OIDC mode, an `Origin` header equal to `A2A_AUTH_ORIGIN` (see [HTTP API](../reference/http-api.md#origin-check-csrf)).

Read the IDs of teams, memberships and grants with `GET /api/admin/security`. It returns `{ organizationId, teams, memberships, teamMembers, grants, credentials }`.

Create the team:

```json
{ "action": "createTeam", "name": "Payments" }
```

Add a member:

```json
{ "action": "addTeamMember", "teamId": "TEAM_UUID", "membershipId": "MEMBERSHIP_UUID" }
```

Grant one skill:

```json
{ "action": "grant", "subjectType": "team", "subjectId": "TEAM_UUID", "agentId": "AGENT_UUID", "skillId": "refunds", "permission": "operate" }
```

Use `"skillId": null` for the whole agent. For everyone, use `"subjectType": "organization"` with your `organizationId` as `subjectId`. For one person, use `"subjectType": "membership"` with their membership ID. Each success returns `{ "updated": true }`. The full list of actions is in the [HTTP API reference](../reference/http-api.md#post-apiadminsecurity).

## Check the result

1. In **Administration**, **Agent access** lists each grant with the recipient, agent, skill and permission. Only enabled grants are listed.
2. Ask a team member to sign in and open **Agents**. They see `Billing agent` with the description `Restricted skill access` and only the `Refunds` skill. The other skills, and the agent's own description, are hidden.
3. When they start a task with that agent, the chat shows a **Skill** picker with only the granted skills. Taskbay sends the skill id to the agent in the skill-routing metadata.
4. Their task lists show only tasks recorded for that skill.
5. The **Audit** page records each change: `team.created`, `team.addTeamMember`, `access.granted`.

Browsing an agent's tasks and tracking them need an `operate` grant on the **whole** agent (or the administrator role). A skill grant never allows it, and a person with only skill grants never sees tracked or discovered tasks ([Task discovery](connect-an-agent.md#task-discovery)).

A member with a skill grant cannot send to the agent without a skill, cannot pick another skill, and cannot continue an arbitrary existing context. Those sends fail with `403` (see the table below).

## Revoke access

To revoke a grant, select **Revoke** on its row in **Agent access**, or send:

```json
{ "action": "revokeGrant", "grantId": "GRANT_UUID" }
```

To take one person out of a team, select **Remove** on their `Payments · Name` row, or send `removeTeamMember` with the `teamId` and `membershipId`. They lose the team's grants but keep any grants made to them directly or to the whole organization.

To switch off a whole team, send:

```json
{ "action": "disableTeam", "teamId": "TEAM_UUID" }
```

All of the team's grants stop applying. On **Teams**, select **Disable** on the team and confirm.

Revocation applies to the person's next request. A revoked grant is disabled, not deleted, and the change is audited as `access.revoked`. Work Taskbay has already accepted into the worker continues.

## When it fails

Errors from **Administration** appear as a red message above the forms.

| Symptom | Cause | Fix |
| --- | --- | --- |
| **Administration** is missing, or says "Administrators only" | You are not an administrator. `GET /api/admin/security` returns `403`. | Sign in as an `admin`, or ask one to run `auth:provision` with `--role admin` for you. |
| A person is missing from a team's **Add a person…** list or the recipient list | Their membership or user is disabled, or they were never provisioned in this organization. | Provision them with `npm run auth:provision`. |
| Only **Whole agent** is offered as a scope | The agent's card has not been discovered, or it lists no skills. | Open the agent on the **Agents** page so its card loads, then reload **Agent access**. |
| `400 Invalid access management request.` | The API body has a missing or extra field, an ID that is not a UUID, an unknown `permission` or `subjectType`, or a `name` longer than 200 characters. | Match the bodies above exactly. |
| `Unknown agent.` | The agent ID is not an enabled agent in your organization. | Use an `id` from `GET /api/agents`. |
| `Unknown grant subject.` | The person or team is unknown or disabled, or an `organization` grant names another organization's ID. | Use IDs from `GET /api/admin/security`. |
| `Unknown team.` | The team ID is unknown or the team is disabled. | Use an enabled team. |
| `Unknown membership.` | The membership ID is unknown or disabled. | Use an ID from `memberships` in `GET /api/admin/security`. |
| `Unknown grant.` | The grant ID does not exist in your organization. | Use an ID from `grants` in `GET /api/admin/security`. |
| `403 This action is not permitted.` | A non-admin called the access API, or a mutating request had the wrong `Origin`. For a member: their role is `viewer`, or their grant does not cover the action or the skill they named. | Check the role and the grant. A viewer needs a role change to operate. |
| A member sees an empty catalog, or `404` on a task link | They have no enabled grant for that agent or skill. Taskbay answers `404`, not `403`, so it does not reveal that the task exists. | Grant the agent or skill to the person, a team they belong to, or the organization. |
| `403 This agent does not support bounded skill routing.` | The agent's stored card does not advertise the skill-routing extension, or does not list that skill id. | Add the extension and skill to the agent's card and reload the catalog, or grant the whole agent instead. |
| `403 A skill-scoped send must start a new context.` | A member with only skill grants sent a `contextId` without a task. | Start a new task, or continue an existing one by its task ID. |
| `403 Task skill cannot be changed.` | A follow-up named a different skill than the task's. | Send follow-ups without a skill, or with the task's skill. |
| `429 Too many requests. Try again shortly.` | More than 60 administrative calls in one minute from your membership. | Wait a minute. |

## Limits

- A skill grant relies on the agent. Taskbay picks the skill and sends it, but cannot check that the agent enforces it. Use skill grants only for agents whose enforcement you have reviewed. See the [skill routing reference](../reference/extensions/skill-routing.md).
- When a card snapshot is available, a skill grant must name a skill on the public Agent Card; an extended-only or unknown skill is refused with `Only skills on the public Agent Card can be granted.` Without any stored card snapshot, grant creation can accept the ID, but sending still checks the public skill and skill-routing support.
- The same grant can be created twice. Each copy is a separate row, and revoking one leaves the other in force. Check the list before granting again.
- Teams cannot be renamed, deleted or re-enabled. Disabling is the only change. A disabled team is hidden from **Teams** and **People**, and its grants do not apply.
- A grant on an `admin` is accepted and has no effect.
- There is no CLI for teams or grants, and no sync from identity-provider groups. Provider group and role claims grant nothing.
- Teams cannot be escalation targets.
- One organization per deployment.

## Related

- [Sign in and roles](./sign-in-and-roles.md)
- [Identity and access](../concepts/identity-and-access.md)
- [Skill routing extension](../reference/extensions/skill-routing.md)
- [HTTP API: access management](../reference/http-api.md#access-management)
- [Use the console](./use-the-console.md): where grants take effect, screen by screen.
