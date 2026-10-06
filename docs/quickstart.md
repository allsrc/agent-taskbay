# Quickstart

> Who this is for: someone who wants to see Agent Taskbay work on their own machine. At the end you will have run the console, connected a sample A2A agent, sent it a task, approved an action as a reviewer, and seen the result recorded.

Agent Taskbay is pre-1.0 (package version `0.1.0`). It is published to npm, so `npx agent-taskbay` is the quickest way to run it (last section). The first sections run it from a git checkout, which is also how you develop it.

## Before you start

- Node.js 22.19.0 or newer (`engines` in `package.json`; `.nvmrc` pins 22.19.0), and git.
- Two free local ports: 3002 for the console and 4010 for the sample agent. Both can be changed.
- No database, account or `.env` file is needed. The default database is an embedded PGlite directory under `./.data`, migrations are applied on start, and `npm run dev` signs you in as a development administrator.

This quickstart is local-only. The development identity grants administrator rights to anyone who can reach the port, so do not expose it. For real sign-in see [Sign in and roles](guides/sign-in-and-roles.md).

## 1. Run the console from source

```bash
git clone https://github.com/allsrc/agent-taskbay.git
```

```bash
cd agent-taskbay && npm ci
```

```bash
npm run dev
```

The dev script runs `next dev -p 3002`, so the console is at `http://localhost:3002`. The first start applies the database migrations and can take a while because pages compile on demand. I did not time or capture the output of `npm run dev`; the transcript in the `npx` section below comes from the production launcher.

## 2. Start the sample agents

In a second terminal, from the same checkout:

```bash
node scripts/fixture-form-agent.mjs 4010
```

Expected output:

```text
http://127.0.0.1:4010/form/card.json
http://127.0.0.1:4010/plain/card.json
http://127.0.0.1:4010/invalid/card.json
```

This is a test fixture, not a real agent. One server serves several variants, each with its own Agent Card at `/<variant>/card.json`:

| Card URL | What the agent does |
| --- | --- |
| `http://127.0.0.1:4010/showcase/card.json` | Picks a behavior from your message: a form (default), an A2UI surface (message contains "surface") or an approval request (message contains "approve"). Used below. |
| `http://127.0.0.1:4010/form/card.json` | Asks for a deployment form. Advertises the structured-form extension. |
| `http://127.0.0.1:4010/approver/card.json` | Asks a person to approve an action. |
| `http://127.0.0.1:4010/a2ui/card.json` | Asks for confirmation with an A2UI surface. |
| `http://127.0.0.1:4010/plain/card.json` | Sends a form without advertising the extension, so the console shows it as plain data. |
| `http://127.0.0.1:4010/invalid/card.json` | Advertises the extension but sends a form outside the supported subset, so the console falls back to plain data. |

The printed list only shows `form`, `plain` and `invalid`; the other variants are served by the same process. I confirmed `showcase`, `form`, `approver` and `a2ui` through the packaged `demo-agent` command, which uses the same fixture code.

## 3. Connect the agent

1. Open `http://localhost:3002/agents`.
2. Choose **Add agent**. The dialog is titled "Connect agent".
3. Paste `http://127.0.0.1:4010/showcase/card.json` and choose **Fetch Agent Card**. You see the agent name, version, skill count, whether it streams, and its advertised security (the fixture advertises none).
4. Choose **Continue**, then **Connect**.

The agent appears in the list with a success-coloured dot ("Reachable" on hover). **Register URL** on the first step saves the URL without fetching the card; an unreachable URL then shows up in the list with a different dot ("Discovery failed" on hover) and an error instead of failing the dialog.

More detail, including protected agents, is in [Connect an agent](guides/connect-an-agent.md).

## 4. Send a task that needs a person

1. Open the agent and choose **Start chat**.
2. Send this message: `please approve the deploy`.

The showcase agent creates a task, moves it to input-required, and attaches an approval request. The console opens a pending approval titled "Delete the staging cluster" with risk High and quotes your message in its summary.

I ran this exchange against the real server through the HTTP API (`POST /api/agents/<id>/commands`, which returns 202 with a command ID). I read the chat screens from the source rather than clicking through them, so treat the exact on-screen layout as unverified.

## 5. Review and approve

1. Open **Inbox**. The default view, "Needs you", lists the task and the approval. The sidebar badge on Inbox shows pending approvals. Notifications also appear under **Notifications**.
2. Open the approval. It shows the proposed action, a content digest and revision number, and a note that the agent opened it and cannot decide it.
3. Choose **Approve** and confirm the prompt ("Approve this action? It will be sent to the agent once and cannot be undone."). A rationale is optional for approve and required for every other outcome.

Approving sends exactly the displayed content to the agent, once. When I did this against the running server, the approval became `approved`, an execution record reached `succeeded`, and the task moved to `TASK_STATE_COMPLETED`. The approval page's **Result** card then reads "Delivered to the agent; task is now" followed by the state name.

The full set of reviewer actions is in [Approvals and ownership](guides/approvals-and-ownership.md).

## 6. See the durable record

- **Tasks** lists the task with its status timeline, history and identifiers.
- The approval page lists the decision record and every revision.
- **Audit** (administrators only) lists each step. The approval page links to the trail for its task.

Everything above is stored in the database, not in the browser. The state lives in `./.data/pglite` (database) and `./.data/artifacts` (binary content). Because the state is on disk rather than in the page, it should survive a restart. I did not restart the server for this page; the repository's HTTP checks (`npm run test:http`) include a restart test that I did not re-run.

## Run it with `npx`

Once a release is published, the same experience should need no checkout:

```bash
npx agent-taskbay
```

```bash
npx agent-taskbay demo-agent
```

These commands exist in `bin/agent-taskbay.mjs` today. I ran that file from a checkout that already had a production build (`npm run build`), using a scratch data directory:

```bash
node bin/agent-taskbay.mjs --data-dir ./scratch-data --no-open -p 3055
```

```bash
node bin/agent-taskbay.mjs demo-agent 4055
```

The first command printed the Next.js start banner and the migrations as they applied, then:

```text
  Agent Taskbay 0.1.0 is running at http://127.0.0.1:3055
  Data: <your data dir>
  Local mode: you are signed in as a development administrator. Only this machine can connect.
  Try it with sample agents: npx agent-taskbay demo-agent
```

The second printed the four showcase card URLs (`showcase`, `form`, `approver`, `a2ui`) on the port you gave, defaulting to 4010. The launcher's data directory defaults to `~/.agent-taskbay` (or `A2A_DATA_DIR`), it writes generated vault keys to `secrets.json` in that directory with mode 0600, and it refuses to bind a non-loopback address unless OIDC is configured. The text printed by `demo-agent` says "choose Connect agent", but the button in the Agents list is **Add agent**.

The packaged version needs a production build to exist. In a git checkout run `npm run build` first. Without it the launcher stops with "There is no production build."

## When it fails

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| `npm ci` or the dev server refuses to run | Node older than 22.19.0 | Check `node --version`; use `nvm use` in the checkout. |
| The Agents list shows your agent with the "Discovery failed" dot and "Agent network request failed." | The card URL is unreachable. I saw this message for a card on a closed port. | Check the sample agent is running and the URL matches its output. |
| The error says the target is not in the allowlist, or blocked | Production builds only reach exact origins in `A2A_ALLOWED_AGENT_ORIGINS`, and block private addresses unless `A2A_ALLOW_PRIVATE_NETWORKS=true`. The launcher sets the private-network option for you in local mode. | See [Connect an agent](guides/connect-an-agent.md#when-it-fails). |
| `Agent Taskbay is already running for <dir> (pid ...)` | A second launcher on the same data directory. The embedded database allows one owner. | Stop the first process or pass `--data-dir`. |
| Database error when starting a second `npm run dev` or script against the same `.data` | PGlite has a single owner process. | Stop the other process. CLIs that touch the database need `--offline-pglite` while it is stopped. |
| The approval never appears | The message did not contain "approve", so the showcase agent sent a form instead. | Use the exact message above, or open the task and choose **Request approval** to record one yourself. |
| Approve is disabled or refused: "The requester cannot decide their own request." | Separation of duties is on by default. | Agent-opened requests have no requester, so this only hits approvals you created yourself. Ask another reviewer. |

## Limits

- The sample agents are a test fixture. They do not do any real work and their cards are unsigned.
- This runs one user as a local administrator. Multi-user sign-in needs OIDC and provisioning ([Sign in and roles](guides/sign-in-and-roles.md)).
- Pre-1.0: interfaces may change between minor versions.

## Related

- [Connect an agent](guides/connect-an-agent.md): real agents, credentials and grants.
- [Build an agent for Taskbay](guides/build-an-agent-for-taskbay.md): what the fixture agent does and how to write one.
- [Approvals and ownership](guides/approvals-and-ownership.md): the reviewer workflow.
- [Notifications](guides/notifications.md): the in-app inbox and the signed webhook.
