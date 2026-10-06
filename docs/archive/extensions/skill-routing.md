# Skill routing extension (v1)

URI: `https://extensions.allsrc.dev/agent-taskbay/skill-routing/v1`

An advertised A2A skill is descriptive, not an invocation boundary. Agent Taskbay can restrict a user to one skill of an agent only
when the agent advertises this extension and enforces the route.

## Contract

- The console sets `SendMessage` request metadata under the extension URI to `{ "skillId": "<id>" }` and includes the URI in the
  negotiated request extensions.
- The agent must enforce that route, reject unsupported skills, and keep newly created contexts within the skill.
- A restricted caller cannot supply an arbitrary existing context, reference an unseen task, or override the routing metadata. New
  restricted sends start a new context; follow-ups preserve the task's skill.
- Agents that do not implement this contract require a whole-agent operate grant. Routing is never inferred from prompts, tags or
  examples.

Grants do not constrain a non-cooperating agent's internal behavior; enable this extension only for reviewed infrastructure. See
[ADR 0014](../adr/0014-service-credentials-and-scoped-security.md) and the
[service identity runbook](../security/SERVICE_IDENTITY.md).
