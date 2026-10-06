# Agent Taskbay extensions

Agent Taskbay defines three optional A2A extensions. An agent opts in by listing the extension URI under `capabilities.extensions` in
its Agent Card. Without that advertisement the console ignores the extension and treats the content as ordinary A2A data.

| Extension | URI | Purpose |
| --- | --- | --- |
| [Structured form](./structured-form.md) | `https://extensions.allsrc.dev/agent-taskbay/structured-form/v1` | Ask the user for typed input, or offer a start-of-task form |
| [Approval request](./approval-request.md) | `https://extensions.allsrc.dev/agent-taskbay/approval-request/v1` | Ask a reviewer to approve an exact action |
| [Skill routing](./skill-routing.md) | `https://extensions.allsrc.dev/agent-taskbay/skill-routing/v1` | Let the console restrict a send to one skill |

The URIs are identifiers. Versions are immutable: an incompatible change is published as a new `/v2`, never by editing `/v1`.
The decisions behind each extension are in [ADR 0014](../adr/0014-service-credentials-and-scoped-security.md),
[ADR 0020](../adr/0020-structured-input-forms.md) and [ADR 0023](../adr/0023-agent-originated-approvals.md).
