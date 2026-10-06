# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**
(<https://github.com/allsrc/agent-taskbay/security/advisories/new>). Include what you found, how to reproduce it, the version
or commit, and what an attacker could do with it.

You can expect an acknowledgement within a few days. Fixes are developed in a private advisory, released, and then disclosed with credit
to the reporter unless you prefer otherwise. This is a volunteer-maintained project, so please allow reasonable time.

## Supported versions

Only the latest published `0.x` release receives security fixes. The project is pre-1.0 and interfaces may change between minor versions.

## Scope and deployment guidance

Agent Taskbay is a server that holds credentials for your agents and can send work to them. Treat it accordingly.

- **Local mode is not a security boundary.** `npx agent-taskbay` signs everyone in as a development administrator and binds only to
  loopback. Do not expose it to a network, a tunnel or a shared machine. The launcher refuses non-loopback addresses unless OIDC is configured.
- **Production requires OIDC**, an exact outbound origin allowlist (`A2A_ALLOWED_AGENT_ORIGINS`), HTTPS, and server-only secrets. Production
  fails closed without them. See the README sections on identity and sign-in and `docs/security/SERVICE_IDENTITY.md`.
- Credentials for agents are stored encrypted in the database and never sent to the browser. Keep the vault keys and the push signing key
  out of version control, logs and backups that are not themselves protected.
- The threat model is in [`docs/security/THREAT_MODEL.md`](docs/security/THREAT_MODEL.md). Findings that contradict it are especially welcome.

In scope: authentication and session handling, authorization and tenant isolation, credential storage, outbound request controls (SSRF,
DNS rebinding, redirects), webhook authentication and replay, artifact handling, rendering of agent-supplied content, and the audit trail.

Out of scope: vulnerabilities in third-party agents, denial of service from an administrator's own configuration, and issues that require
an attacker who already has database or server access.
