# Compatibility and known limitations

> For anyone deciding whether Agent Taskbay fits their environment and agents: supported runtime versions, which A2A versions, transports and authentication schemes the gateway
> handles or refuses, what is experimental, and a table of known limitations with issue links.

Agent Taskbay is **pre-1.0** (package version `0.1.0`) and, at the time of writing, not yet published to npm. Interfaces may change between minor versions. "Tested" in this page means what
the repository's own CI runs; nothing here is a claim about other versions or environments.

## Runtime versions

| Component | Version | Source |
| --- | --- | --- |
| Node.js | `>=22.19.0` (the only version CI runs: `22.19.0`) | `engines` in `package.json`; `.nvmrc`; `.github/workflows/ci.yml` and `release.yml` |
| PostgreSQL | CI runs `postgres:18-alpine`. No other version is tested. | `.github/workflows/ci.yml` |
| Embedded database | PGlite `0.5.8` (through `@mikro-orm/pglite` `7.2.3`), single process only | `package-lock.json` |
| A2A SDK | `@a2a-js/sdk` `^1.3.0` (locked at `1.3.0`) | `package.json`, `package-lock.json` |
| Web framework | Next.js `16.3.6`, React `19.3.0` | `package.json` |
| ORM | MikroORM `7.2.3` | `package.json` |
| Operating systems | CI runs `ubuntu-latest` only. The launcher has code to open a browser on macOS, Windows and Linux; Windows is not tested. | `ci.yml`, `bin/agent-taskbay.mjs` |
| Browsers | Not verified. The repository declares no browser support list and has no cross-browser test suite. | `package.json` |

`npm run check` is what CI runs: lint, unit tests, database tests (PGlite, plus PostgreSQL when `A2A_TEST_POSTGRES_URL` is set), migrations, schema-drift check, production build, and the HTTP
verification scripts. A second CI job packs the project, installs the tarball into an empty directory and drives the launcher (`npm run verify:package`).

The production build uses webpack (`next build --webpack`); development uses Turbopack. The Next.js version here has differences from earlier releases; contributors should read the guide
in `node_modules/next/dist/docs/` ([Development](../contributing/development.md)).

## A2A protocol support

The gateway uses the official `@a2a-js/sdk` for protocol handling.

| Area | Supported | Notes |
| --- | --- | --- |
| Agent Card v1.0 | Yes | Discovery reads `/.well-known/agent-card.json` (also tries the supplied URL, or the URL itself when it ends in `.json`) and sends `A2A-Version: 1.0`. A v1 card is detected by `supportedInterfaces`. |
| Agent Card v0.3 | Yes, through the SDK's legacy compatibility | Detected by a `url` or a `0.3` `protocolVersion`. Normalized to the v1 shape. The compliance report flags mixed or custom fields. **Not verified against real v0.3 agents** in this reference. |
| Compliance report | Yes | Each discovery produces a score and issue list (`error`, `warning`, `info`). It is advisory: a card with errors is still registered. |
| Transports | JSON-RPC and HTTP+JSON (REST) | The SDK's JSON-RPC and REST transports are registered, with legacy compatibility on. You can pin a binding, interface URL and version in the connection; by default the SDK picks. |
| gRPC | **Not supported.** | gRPC interfaces are removed from the card before a client is built, and an explicitly selected gRPC interface fails with `gRPC transport is unavailable under the hardened network policy; advertise an HTTP binding.` (the SDK's gRPC client cannot be bound to the connection-time address check). |
| Other transports | Not supported | Only the two above are registered. Behavior for an unknown binding was not tested. |
| Streaming (`SendStreamingMessage`, `SubscribeToTask`) | Yes, when `capabilities.streaming` is true | Workers own the stream. If the card does not advertise streaming the task is not streamed (`STREAMING_UNSUPPORTED` internally) and Agent Taskbay relies on polling. |
| Polling (`GetTask`, `ListTasks`) | Yes | Reconciliation polls open tasks. An agent that cannot list tasks falls back to `GetTask` only. |
| `SendMessage`, `CancelTask` | Yes | Always sent as "return immediately"; progress is observed separately. |
| Push notifications | Optional | Worker-managed registration with create, get, list and delete of configs. Needs `A2A_PUSH_CALLBACK_ORIGIN` and a callback reachable by the agent. Off by default. |
| Extended Agent Card | Display only | The agent page shows whether the card advertises it. No route fetches the extended card in this version. |
| Multi-tenancy | Yes | The `tenant` field is part of task identity. |
| Parts | `text`, `raw`, `url`, `data` | Binary parts are stored in the artifact store; remote URLs are shown as provenance and are not loaded by the console. |
| Task states | The A2A set | `AUTH_REQUIRED` is displayed; Agent Taskbay does not perform the authorization the agent needs ([#1](https://github.com/allsrc/agent-taskbay/issues/1)). |

Network limits that apply to every outbound call: redirects are never followed; responses over 25 MiB and Agent Cards over 2 MiB are rejected; the default timeout is 60 seconds; private,
loopback and reserved addresses are blocked unless allowed; the destination must be on the origin allowlist when one is configured or in production ([Configuration](configuration.md#outbound-network-policy)).

### Authentication Agent Taskbay can present to an agent

One credential binding per agent, stored encrypted ([Agent credentials](../guides/agent-credentials.md)). The operator chooses the credential; the card's `securitySchemes` are checked
for shape but are **not** used to pick or negotiate a scheme.

| Scheme | Supported | Notes |
| --- | --- | --- |
| Bearer token | Yes | `Authorization: Bearer <token>`. |
| API key in a header | Yes | Any header name matching `[a-zA-Z0-9-]+` except `Host`, `Cookie`, `Set-Cookie`, `Connection`, `Content-Length`, `Content-Type`, `Transfer-Encoding` and `Proxy-Authorization`. |
| OAuth 2.0 client credentials | Yes | `client_secret_post` against a configured token endpoint (HTTPS, and on the allowlist when one is set). The token is fetched per connection and not stored. Only `Bearer` token types are accepted. |
| Mutual TLS | Yes | Client certificate and key, optional CA, with certificate validation always on. |
| HTTP Basic | **No** | Not accepted by the credential schema, so it cannot be stored. |
| API key in a query string or cookie | **No** | URLs may not contain query strings or fragments, and cookies are stripped. |
| OAuth authorization code, OpenID Connect or per-user delegated credentials | **No** | One shared service credential per agent; no per-user tokens ([#1](https://github.com/allsrc/agent-taskbay/issues/1)). |
| Unauthenticated | Yes | If the card declares `securityRequirements` and no credential (or mTLS) is configured, the call is refused with `Agent credentials are required.` |

Credentials are bound to origins: a credential is sent only to the origins listed in its binding (up to 20, HTTPS), and never to another host. Secrets are redacted from responses and diagnostics.

### Agent Card signatures

| Item | Behavior |
| --- | --- |
| Algorithms | `RS256`, `ES256`, `EdDSA` |
| Keys | Only keys you pin in `A2A_TRUSTED_CARD_KEYS` (per origin, with `kid` and an expiry). A key URL in a card is never fetched. |
| Rejected | Signatures with `crit` headers or `b64: false`, unknown `kid`, expired pins, algorithm mismatch, private key material in a pin |
| Result | `unsigned`, `verified`, `untrusted` (signed, but no matching pin) or `invalid` (signed, a pin matched, verification failed) |
| Policy | Unsigned cards are allowed unless `A2A_REQUIRE_SIGNED_CARDS=true`. `untrusted` and `invalid` cards are always refused for sending. |

## Sign-in (people)

| Item | Supported |
| --- | --- |
| OpenID Connect authorization code with PKCE (`S256`), `client_secret_post`, ID tokens signed `RS256` | Yes. Scope `openid profile`. HTTPS issuer and origin only. |
| One organization per deployment configuration | Yes (`A2A_AUTH_ORGANIZATION_SLUG`) |
| Roles `admin`, `operator`, `viewer`, plus per-agent and per-skill grants for organizations, people and teams | Yes |
| Development identity (everyone is an administrator) | Yes, for local use only |
| SAML, password login, other ID token algorithms, SCIM, group claims as roles, API tokens | No |

## Experimental and stable

"Stable" here means implemented and covered by the repository's automated tests, **not** that the interface is frozen. Nothing is frozen before 1.0.

| Feature | Status | Evidence in the repository |
| --- | --- | --- |
| Agent catalog, discovery, compliance report | Implemented | `src/lib/compliance.ts`, `verify-task-http` |
| Durable commands, dispatch, idempotency, uncertain outcomes | Implemented | `commands.db.test.ts`, `verify-task-http` |
| Streaming observation, push, polling reconciliation, projections, rebuild | Implemented | `*.db.test.ts`, `verify-task-http` |
| OIDC sign-in, roles, grants, credential vault, card trust | Implemented | `verify-identity-http`, `verify-service-security` |
| Approvals as decisions on an exact revision, ownership, escalation, audit, notifications, unified inbox | Implemented | `verify-decisions-http`, `verify-workflow-http`, `verify-notifications-http` |
| Saved views, search, advanced filters, bulk triage | Not implemented | [#5](https://github.com/allsrc/agent-taskbay/issues/5) |
| Structured form extension | Experimental | `verify-forms-http`; no automated browser suite ([#14](https://github.com/allsrc/agent-taskbay/issues/14)) |
| Agent approval-request extension | Experimental | `verify-agent-approvals-http` |
| Skill routing extension | Experimental | `scoped-security` tests |
| A2UI renderer (v0.9 subset) | Experimental | `verify-a2ui-http`; no third-party agent test ([#25](https://github.com/allsrc/agent-taskbay/issues/25)) |
| AG-UI adapter | Experimental, off by default | `verify-agui-http`; no real client test ([#13](https://github.com/allsrc/agent-taskbay/issues/13)) |
| Local launcher (`npx agent-taskbay`) | Implemented, single user | `verify:package` |
| Extension plugin contract | Not implemented | [#26](https://github.com/allsrc/agent-taskbay/issues/26) |
| Client SDK and stable `/api/v1` | Not implemented | [#31](https://github.com/allsrc/agent-taskbay/issues/31) |
| Container images, Helm chart | Not provided | See [Production deployment](../guides/production-deployment.md) |

## Known limitations

| Limitation | Consequence | Issue |
| --- | --- | --- |
| No user-delegated OAuth for agents | One shared credential per agent; the agent cannot tell which person acted, and in-task `AUTH_REQUIRED` flows are not completed by Agent Taskbay | [#1](https://github.com/allsrc/agent-taskbay/issues/1) |
| No saved views, search, advanced filters or bulk triage | Inbox and task lists have fixed views; large queues are slow to triage | [#5](https://github.com/allsrc/agent-taskbay/issues/5) |
| AG-UI `threadId` used as the A2A `contextId` verbatim | Thread IDs are not isolated per agent | [#8](https://github.com/allsrc/agent-taskbay/issues/8) |
| AG-UI refuses skill-scoped principals | Skill-scoped people cannot use the adapter | [#9](https://github.com/allsrc/agent-taskbay/issues/9) |
| AG-UI ignores tools, context, state and non-text content | Only plain text prompts work | [#10](https://github.com/allsrc/agent-taskbay/issues/10) |
| AG-UI refuses cross-origin browsers | Same-origin clients only | [#11](https://github.com/allsrc/agent-taskbay/issues/11) |
| AG-UI runs end after 50 seconds | Long tasks continue but the stream stops with `run_timeout` | [#12](https://github.com/allsrc/agent-taskbay/issues/12) |
| AG-UI not verified against a real client or schema | Compatibility with real AG-UI clients is unknown | [#13](https://github.com/allsrc/agent-taskbay/issues/13) |
| No automated browser tests for structured forms | Regressions rely on unit tests and manual checks | [#14](https://github.com/allsrc/agent-taskbay/issues/14) |
| Replies can bypass an open approval request | An approval is a record and trigger, not a lock; there is no "approval required" policy | [#16](https://github.com/allsrc/agent-taskbay/issues/16) |
| No agent-side verification contract for the approval digest | "Executed as approved" cannot be proven | [#17](https://github.com/allsrc/agent-taskbay/issues/17) |
| No adapter for framework-specific approval pauses (ADK) | Agents must use the approval-request extension | [#18](https://github.com/allsrc/agent-taskbay/issues/18) |
| The project's extensions are not proposed to the A2A project | They are specific to Agent Taskbay | [#19](https://github.com/allsrc/agent-taskbay/issues/19) |
| Approval requests are not AG-UI interrupts | AG-UI clients cannot approve | [#20](https://github.com/allsrc/agent-taskbay/issues/20) |
| A2UI lacks media, lists, tabs, modals, date and slider components | Those components render as placeholders | [#22](https://github.com/allsrc/agent-taskbay/issues/22) |
| A2UI lacks catalog functions, validation checks, `openUrl`, `sendDataModel` | Not evaluated | [#23](https://github.com/allsrc/agent-taskbay/issues/23) |
| A2UI renders in Chat only, with no merge rule for edits | Task and approval pages show raw data | [#24](https://github.com/allsrc/agent-taskbay/issues/24) |
| A2UI not verified against real agents or official schemas | Wire-shape variants are unconfirmed | [#25](https://github.com/allsrc/agent-taskbay/issues/25) |
| No extension plugin contract | Adding an extension means changing the code | [#26](https://github.com/allsrc/agent-taskbay/issues/26) |
| Wire and persisted identifiers still use `a2a`/`a2a-ops` naming | Environment variables, cookie names and extension URIs will change in one breaking release | [#27](https://github.com/allsrc/agent-taskbay/issues/27) |
| No client SDK, service-token auth or stable `/api/v1` | Scripts need a browser session cookie and a matching `Origin` | [#31](https://github.com/allsrc/agent-taskbay/issues/31) |

Not tracked as issues, but true of this version:

- gRPC, HTTP Basic and query-string API keys for agents are unsupported (above).
- PGlite supports one process: embedded dispatch only, no separate worker and no replicas. Use PostgreSQL for anything shared.
- No built-in data retention, redaction or purge for stored raw events.
- No horizontal-scale or load figures are published; none were measured for this reference.

## Further reading

- [Decision record: service credentials and scoped security](../archive/adr/0014-service-credentials-and-scoped-security.md)

## Related

- [Configuration](configuration.md)
- [HTTP API](http-api.md)
- [Extensions](extensions/README.md)
- [Project status and roadmap](../project/status-and-roadmap.md)
