# Documentation

> Find the page that answers your question. Each page answers one. Start with your role, or scan the task list below.

Agent Taskbay is pre-1.0. If a word is unfamiliar, the [glossary](reference/glossary.md) defines it and links to the page that explains it.

## Start here

- **Can I make it work?** [Quickstart](quickstart.md): run the console, connect a sample agent, approve an action.
- **Is it ready for what I need?** [Status and roadmap](project/status-and-roadmap.md) and [Compatibility and limitations](reference/compatibility.md).
- **How does it work?** [Overview](concepts/overview.md).

## By role

| You are | Read, in order |
| --- | --- |
| Evaluating whether to use it | [Overview](concepts/overview.md), [Quickstart](quickstart.md), [Status and roadmap](project/status-and-roadmap.md), [Compatibility](reference/compatibility.md), [Threat model](security/threat-model.md) |
| Using the console day to day | [Use the console](guides/use-the-console.md), [Approvals and ownership](guides/approvals-and-ownership.md), [Notifications](guides/notifications.md) |
| Running it for a team | [Production deployment](guides/production-deployment.md), [Configuration recipes](guides/configuration-recipes.md), [Sign in and roles](guides/sign-in-and-roles.md), [Teams and grants](guides/teams-and-grants.md), [Agent credentials](guides/agent-credentials.md), [Running and workers](operations/running-and-workers.md), [Upgrading and backups](guides/upgrading-and-backups.md), [Find and steer tasks started elsewhere](guides/find-and-steer-tasks-started-elsewhere.md) |
| Building or connecting an agent | [Connect an agent](guides/connect-an-agent.md), [Build an agent for Taskbay](guides/build-an-agent-for-taskbay.md), [Extensions](reference/extensions/README.md), [Receive push callbacks](guides/agent-push-callbacks.md), [Find and steer tasks started elsewhere](guides/find-and-steer-tasks-started-elsewhere.md), [A2UI subset](reference/a2ui.md) |

## Guides

How do I...

- **...use each screen** (Agents, Chat, Tasks, Flows, Audit, Settings)? [Use the console](guides/use-the-console.md)
- **...connect an A2A agent** from its Agent Card? [Connect an agent](guides/connect-an-agent.md)
- **...connect an agent that needs authentication** (bearer token, API key, OAuth client credentials, mTLS), pin card signing keys, or restrict outbound origins? [Agent credentials and outbound policy](guides/agent-credentials.md)
- **...let agents push task updates** to Taskbay instead of waiting for polling? [Receive push callbacks from agents](guides/agent-push-callbacks.md)
- **...build an agent** that asks for forms or approvals? [Build an agent for Taskbay](guides/build-an-agent-for-taskbay.md)
- **...review approvals, own tasks and escalate** overdue work? [Approvals and ownership](guides/approvals-and-ownership.md)
- **...get notified,** in the app or by a signed webhook? [Notifications and webhooks](guides/notifications.md)
- **...set up OIDC sign-in** and provision people? [Sign in and roles](guides/sign-in-and-roles.md)
- **...give a team access** to one agent or one skill? [Teams and grants](guides/teams-and-grants.md)
- **...pick the right environment variables** for my setup? [Configuration recipes](guides/configuration-recipes.md)
- **...deploy with PostgreSQL** and separate workers? [Production deployment](guides/production-deployment.md)
- **...upgrade, back up and restore?** [Upgrading and backups](guides/upgrading-and-backups.md)
- **...find and take over tasks another system started?** [Find and steer tasks started elsewhere](guides/find-and-steer-tasks-started-elsewhere.md)
- **...try the experimental AG-UI adapter?** [Try the AG-UI adapter](guides/enable-ag-ui.md)

## Concepts

How it works, and why.

- [Overview](concepts/overview.md): what Taskbay is and is not
- [Durable tasks](concepts/durable-tasks.md): commands, workers, streams, push, polling, rebuilds
- [Identity and access](concepts/identity-and-access.md): people, agent credentials, roles, grants
- [Human in the loop](concepts/human-in-the-loop.md): inbox, approvals, ownership, audit, notifications
- [Rich content](concepts/rich-content.md): rendering, forms, A2UI, AG-UI
- [Design decisions](concepts/design-decisions.md): decisions, trade-offs, links to the archived records

## Reference

What exactly is supported?

- [Configuration](reference/configuration.md): every `A2A_*` environment variable, default and error
- [CLI and scripts](reference/cli.md): `agent-taskbay` commands and `npm run` scripts
- [HTTP API](reference/http-api.md): routes, roles, request and error shapes
- Extensions: [index](reference/extensions/README.md), [structured form](reference/extensions/structured-form.md),
  [approval request](reference/extensions/approval-request.md), [skill routing](reference/extensions/skill-routing.md)
- [AG-UI adapter](reference/ag-ui.md), [A2UI subset](reference/a2ui.md)
- [Data model](reference/data-model.md)
- [Compatibility and limitations](reference/compatibility.md)
- [Glossary](reference/glossary.md)

## Operations

What happens when it fails?

- [Running and workers](operations/running-and-workers.md)
- [Troubleshooting](operations/troubleshooting.md): look up an error message

## Security

- [Threat model](security/threat-model.md)
- [How agent credentials are protected](security/service-identity.md)
- [Reporting a vulnerability](../SECURITY.md)

## Project and contributing

- [Status and roadmap](project/status-and-roadmap.md), [A2A workflow gap analysis and plan](project/a2a-gap-analysis-and-plan.md), [CHANGELOG](../CHANGELOG.md)
- [CONTRIBUTING](../CONTRIBUTING.md), [Development](contributing/development.md), [Writing documentation](contributing/documentation.md)
- [Archive of the earlier planning documents](archive/README.md)
