# Notifications

> Who this is for: people who use the console (to know what they will be told) and administrators who want the same notifications in a team chat or another system through a signed webhook. At the end you have the in-app inbox understood and, optionally, a verified webhook receiver.

Agent Taskbay creates a notification when something needs a person: an approval to review, a task waiting for input, a task assigned or escalated to you. Everyone gets them in the app. One optional external channel, a signed JSON webhook for one organization, receives a copy of each. There is no email, SMS or push channel, and the webhook is not a per-user subscription.

## Before you start

- To read notifications: any signed-in role. Notifications are personal, and read marks follow you across browsers.
- To configure the webhook: access to the server's environment, an HTTPS endpoint you control (HTTP is accepted in local mode), and the administrator role to use the **Notification channel** card.
- The worker that creates notifications runs inside the console process by default. With an external worker it runs there ([Running and workers](../operations/running-and-workers.md)).

## What you are told

Open **Notifications** (the sidebar shows an unread count, capped at "99+"). Items that ask you to act show an `ACTION` tag. Opening one marks it read and goes to the task or approval.

| Event | Title | Who is told |
| --- | --- | --- |
| Approval opened | Approval needed | The assignee if there is one, otherwise every operator or administrator who can operate that agent, except the opener (and the requester, when separation of duties applies) |
| Approval revised | Revised proposal to review | Same as above |
| Approval assigned or delegated to you | Approval assigned to you | The new assignee |
| Approval decided | Your request was approved, rejected, edited and approved, or sent back for changes | The requester |
| Approval about to lapse | Approval expiring soon (once, within 15 minutes of the deadline, only if it was open long enough to warn) | The assignee, or eligible reviewers |
| Approval expired | Approval expired | The requester and the assignee |
| Approval superseded | Approval superseded | The requester and the assignee |
| Task assigned to you | Task assigned to you | The new assignee |
| Overdue task escalated | Overdue task escalated | The new owner and the previous owner |
| Task needs input or authorization | Input needed / Authorization needed | The owner, or if unowned, up to 25 eligible reviewers |
| Task finished or failed | Task finished / Task failed | The owner only (nobody if unowned) |

Rules that apply to all of them:

- You are never told about your own action.
- A person is only told if they can read the agent (or skill) concerned.
- Text contains only titles the console already shows to anyone who can open the task. It never includes proposal content, rationales or notes.
- Each notification is created once, even if the event is processed twice.

Use the **All** and **Unread** tabs, **Mark all read**, and **Show older notifications** (30 per page). The same data is available at `GET /api/notifications` (query: `limit`, `cursor`, `unread=true`) and `POST /api/notifications/read` (`{"ids": [...]}` or `{"all": true}`). Only your own notifications can be read or marked.

## Set up the webhook

1. Choose a receiver URL. It must have no query string, credentials or fragment. Production builds require HTTPS and an exact-origin entry in `A2A_ALLOWED_AGENT_ORIGINS` (the webhook origin shares the agent allowlist). Private addresses need `A2A_ALLOW_PRIVATE_NETWORKS=true` in production.
2. Generate a secret of at least 32 characters:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

3. Set these in the console's environment and restart:

```bash
A2A_NOTIFY_WEBHOOK_URL=https://hooks.example.com/taskbay
A2A_NOTIFY_WEBHOOK_SECRET=<the secret>
A2A_NOTIFY_WEBHOOK_ORGANIZATION=local
A2A_ALLOWED_AGENT_ORIGINS=https://hooks.example.com
```

`A2A_NOTIFY_WEBHOOK_ORGANIZATION` is the slug of the one organization whose notifications are sent; it defaults to `local`. Setting `A2A_AUTH_ORIGIN` makes the `link` in each payload absolute; without it the link is a path such as `/approvals/<id>`. If the URL is set and the secret is shorter than 32 characters, the setting is rejected: the error is logged and only in-app notifications work. Every variable is listed in [Configuration](../reference/configuration.md).

4. Sign in as an administrator, open **Settings**, and find **Notification channel**. It shows the webhook state ("Not configured", "On → host", or "Configured for another organization"), delivered, waiting/retrying and gave-up counts, and the last failure. The URL and secret are never shown.
5. Choose **Send test notification**. A "Test notification" appears in your inbox and is posted to the webhook.

I ran this against a local build with a throwaway receiver on `127.0.0.1`: the channel card's API reported `delivered: 1` and the receiver got the payload below. I did not test Slack or any other real service.

## The request

Each notification is one `POST` with `Content-Type: application/json`. Headers:

| Header | Value |
| --- | --- |
| `X-Agent-Taskbay-Delivery` | The notification ID. Stable across retries. Use it to deduplicate. |
| `X-Agent-Taskbay-Timestamp` | Unix time in seconds as a string |
| `X-Agent-Taskbay-Signature` | `v1=` followed by the lowercase hex HMAC-SHA256 of `<timestamp>.<raw body>` using your secret |

Body (the test notification as received):

```json
{
  "id": "a39dc89a-e107-41f8-a623-3e9f92ff1dae",
  "kind": "test",
  "organization": "local",
  "title": "Test notification",
  "body": "If you can read this, notifications are working.",
  "text": "Test notification: If you can read this, notifications are working.",
  "link": "/notifications",
  "createdAt": "2026-10-06T20:03:56.620Z",
  "recipients": ["Local operator"]
}
```

`kind` is one of `approval.requested`, `approval.revised`, `approval.assigned`, `approval.decided`, `approval.expiring`, `approval.expired`, `approval.superseded`, `task.assigned`, `task.escalated`, `task.needs_input`, `task.finished`, `task.failed` or `test`. `recipients` are display names. `text` is a one-line summary, with the link appended when `A2A_AUTH_ORIGIN` is set, so a Slack-style incoming webhook that reads `text` works unchanged.

The console gives up on a single request after 10 seconds, does not follow redirects, and treats any non-2xx response as a failure. It does not read the response body.

## Verify the signature

Verify against the exact bytes you received, not re-serialized JSON. Reject old timestamps to limit replay, and deduplicate on the delivery header because delivery is at least once. This receiver was run against signed requests locally: a correct signature returned 204, a wrong one 401.

```js
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.A2A_NOTIFY_WEBHOOK_SECRET;
const MAX_AGE_SECONDS = 300;
const seen = new Set(); // use a shared store with expiry in production

function verify(rawBody, headers) {
  const timestamp = headers["x-agent-taskbay-timestamp"];
  const signature = headers["x-agent-taskbay-signature"] ?? "";
  if (!timestamp || !signature.startsWith("v1=")) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_AGE_SECONDS) return false;
  const expected = createHmac("sha256", SECRET).update(`${timestamp}.${rawBody}`).digest("hex");
  const given = signature.slice(3);
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!verify(body, req.headers)) { res.writeHead(401).end(); return; }
  const id = req.headers["x-agent-taskbay-delivery"];
  if (!seen.has(id)) { seen.add(id); console.log(JSON.parse(body).text); }
  res.writeHead(204).end();
}).listen(Number(process.env.PORT ?? 8787), "127.0.0.1");
```

The 300-second window is a suggestion; the console does not define one.

## Retries and failure behavior

- Creating the in-app notification and sending to the webhook are separate. A failing webhook never delays or blocks in-app notifications.
- A failed delivery is retried with exponential backoff, starting at 5 seconds and capped at 10 minutes, and abandoned after 8 attempts. Abandoned deliveries count under "Gave up" and the card shows the last failure message. They are not resent automatically.
- Delivery is at least once. If your server processed a request but the response was lost, you will see the same `X-Agent-Taskbay-Delivery` again.
- Order is not guaranteed.
- If creating a notification itself fails, it is retried up to five times, then dropped with an internal "could not be created" error. No in-app item exists in that case.
- The queue is stored in the database, so restarting the console does not lose pending deliveries.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| The card says "Not configured" | `A2A_NOTIFY_WEBHOOK_URL` is empty, or was rejected at startup | Set it, and read the console log for the reason |
| "On" never appears, log shows `A2A_NOTIFY_WEBHOOK_SECRET must be at least 32 characters` | Short or missing secret | Use 32 or more characters |
| "Configured for another organization" | `A2A_NOTIFY_WEBHOOK_ORGANIZATION` does not match your organization slug | Set the right slug |
| Log shows "Agent target is not in the configured origin allowlist." or an HTTPS or address error | Webhook origin is not allowed under the same rules as agents | Add the origin to `A2A_ALLOWED_AGENT_ORIGINS`; use HTTPS; allow private networks if the receiver is internal |
| "Gave up" count grows; last failure is "Webhook responded with 401." | Your receiver rejects the signature | Check you hash the raw body, `timestamp.body`, and the same secret |
| Last failure is "Webhook request failed." | Network error, timeout (10 s), TLS problem or a redirect | Test the URL from the console host |
| Receiver gets duplicates | At-least-once delivery | Deduplicate on `X-Agent-Taskbay-Delivery` |
| Nobody receives a notification in the app | The person cannot read that agent, or they caused the event themselves | Check grants |
| No notifications at all | The notification worker is not running (external worker mode) | See [Running and workers](../operations/running-and-workers.md) |

## Limits

- One webhook for one organization. Per-user or per-channel routing, quiet hours, email and mobile push do not exist.
- The webhook carries titles and names, not content. A receiver that needs more must call back into the console.
- The signature scheme has one version (`v1`). Rotating the secret means changing the environment variable and restarting; deliveries signed with the old secret that are still queued are signed at send time, so they use the new one.
- Pre-1.0: payload fields may be added.

## Further reading

- [Decision record: durable notifications](../archive/adr/0018-durable-notifications.md)

## Related

- [Approvals and ownership](approvals-and-ownership.md)
- [Configuration reference](../reference/configuration.md)
- [Running and workers](../operations/running-and-workers.md)
