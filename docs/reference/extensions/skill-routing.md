# Skill routing extension (v1)

> For agent authors and administrators: how Agent Taskbay can restrict a person to one skill of an agent, and why that only works if the agent enforces it.

- **URI:** `https://extensions.allsrc.dev/agent-taskbay/skill-routing/v1`
- **Status:** defined by this project only; not an A2A standard. See the [extensions overview](README.md).

An A2A skill is a description in the Agent Card. It is not an enforcement boundary: an agent that lists three skills will usually answer anything sent to it. If an administrator gives someone
access to only one skill, Agent Taskbay needs the agent's cooperation to make that real. This extension is that contract.

## What this does and does not do

| Agent Taskbay does | The agent must do |
| --- | --- |
| Refuse a skill-restricted send unless the agent advertises this URI **and** lists that skill id in its card | Advertise the URI in `capabilities.extensions` |
| Put the skill in the request metadata and name the URI in the message's `extensions` | Read the skill id from the request metadata and **enforce** it |
| Remember the skill on the task, and block later messages that name another skill | Reject unsupported skills and keep tasks and contexts it creates within the skill |
| Strip any routing metadata a caller tries to supply | |

Agent Taskbay cannot verify that an agent enforces the route. Grants do not constrain a non-cooperating agent's internal behavior. Enable skill-scoped grants only for agents whose enforcement you
have reviewed. Agents that do not implement this contract can only be granted whole-agent access.

## Contract

When a person with a skill-scoped grant sends a message, the command names a skill (`skillId` in the [command body](../http-api.md#command-body)). Agent Taskbay then:

1. checks the stored Agent Card lists a skill with that `id` and advertises this extension URI; otherwise the send is refused with `403 This agent does not support bounded skill routing.`;
2. adds the URI to the message's `extensions` list;
3. sets the request-level metadata of the A2A `SendMessage` request to:

   ```json
   { "https://extensions.allsrc.dev/agent-taskbay/skill-routing/v1": { "skillId": "<id>" } }
   ```

The agent must enforce that route, reject skills it does not support, and keep any new context within the skill.

## Rules enforced by Agent Taskbay

- **Callers cannot set the route.** A routing entry in the caller's `metadata` or `requestMetadata` is deleted; the server writes it only from a validated `skillId`. A send without a `skillId` carries no routing metadata.
- **A skill grant never authorizes a generic send.** A person whose grant covers one skill can send only with that `skillId`. A grant with no skill (whole agent) allows any send. Reading follows the same scope.
- **New contexts only.** A skill-scoped caller cannot start a send inside an arbitrary existing context (`403 A skill-scoped send must start a new context.`).
- **Follow-ups keep the skill.** When a message continues a known task, the skill is taken from the task. Naming a different one is `403 Task skill cannot be changed.`; a `contextId` that does not match the task's is `403 Task context mismatch.`; an unknown task is `404 Task not found.`
- **Referenced tasks must be known** (`referenceTaskIds`): unknown ones are `404`.
- **Approvals inherit the scope.** A request opened for a skill-scoped task, and the message sent on approval, carry that task's skill; a reviewer needs `operate` for that skill.

Visibility is scoped too: someone with access to one skill sees only that skill in the catalog (the card is reduced to the permitted skills and a generic description) and only tasks recorded for it.

## Administrator setup

Grants are created with `POST /api/admin/security` using `action: "grant"` and a `skillId` ([HTTP API](../http-api.md#post-apiadminsecurity)), or in the console's access settings. The model and
the checks are described in [Identity and access](../../concepts/identity-and-access.md).

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `403 This agent does not support bounded skill routing.` | The stored card does not list the skill id, or does not advertise this URI | Advertise the URI and list the skill; load the catalog to refresh the stored card |
| `403 This action is not permitted.` on a send | The person's grant is skill-scoped and the send named no skill, or a different one | Send with the granted `skillId`, or grant the whole agent |
| `403 A skill-scoped send must start a new context.` | A `contextId` was supplied without a task | Omit `contextId`, or continue an existing task by `taskId` |
| The agent answers outside the skill | The agent does not enforce the route | This is the agent's responsibility; do not rely on the grant until it does |

## Limits

- The extension is only as strong as the agent's implementation. Treat a skill-scoped grant as a convenience for cooperating agents, not as a security boundary against a hostile one.
- Routing is never inferred from prompts, tags or examples in the card.
- One skill per send.

## Further reading

- [Decision record: service credentials and scoped security](../../archive/adr/0014-service-credentials-and-scoped-security.md)

## Related

- [Identity and access](../../concepts/identity-and-access.md)
- [Agent credentials](../../guides/agent-credentials.md)
- [Extensions overview](README.md)
- [HTTP API: command body](../http-api.md#command-body)
