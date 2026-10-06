# ADR 0018: Durable notifications and the external channel

- Status: Accepted
- Date: 2026-10-05
- Requirements: NTF-001, NTF-002, HITL-001, HITL-007, SEC-004

## Context

Alerts were derived in the browser from task projections with session-only read marks.
Approvals and ownership (ADRs 0015–0017) need people to be told, durably and privately, and
optionally in a team channel, without putting delivery on the request path.

## Decision

- Events are raised in the transaction that causes them (`notification.event` outbox rows):
  approval opened, revised, assigned or delegated, decided, expiring, expired and superseded;
  task assigned and escalated; and task entering input-required, auth-required, finished or
  failed during ingestion. Entering the same state again re-notifies; replays do not.
- A fan-out worker claims each event with a lease and, in one transaction, decides who is told
  from current state and writes one immutable `Notification` plus one `NotificationRecipient`
  per person. The notification ID is the event's outbox ID, so reprocessing writes nothing.
  Failures retry with backoff and stop after five attempts without blocking other events.
- Recipients: the assignee, otherwise eligible reviewers (enabled operators or administrators
  with an operate grant), excluding whoever caused the event and, for new approvals, the
  requester when separation of duties applies. Outcomes and closures go to the requester (and
  assignee). Every recipient must currently hold at least a read grant on the task's agent.
  Unowned input-required work tells at most 25 eligible reviewers; finished or failed tasks
  tell only an owner.
- Wording is content-light: titles the console already shows to anyone who can open the task
  or approval, never proposal text, rationales or note bodies.
- Read state is a per-recipient `readAt`; only that column can change (database trigger) and a
  member can mark only their own rows. The inbox hides anything about a task the member can
  no longer read, so revoking access withdraws what a notification said.
- One external channel sits behind a `NotificationChannel` port: a signed JSON webhook (with a
  Slack-compatible `text`) for one organization, configured only by server environment. It uses
  the agent network policy (exact origin allowlist, HTTPS in production, per-socket address
  checks, no redirects). Each notification is posted at least once with `X-Agent-Taskbay-Delivery`,
  `X-Agent-Taskbay-Timestamp` and `X-Agent-Taskbay-Signature` (`v1=` HMAC-SHA256 of `timestamp.body`).
  Delivery is an outbox row per notification with bounded exponential backoff, ending in a
  visible `failed` state; failures never affect the inbox, and stored errors are fixed strings
  that contain no URL, status text or secret.
- Administrators see channel health (counts, last failure, host only) and can send a test
  notification through the whole pipeline.
- Expiring warnings fire once, when an open request is within 15 minutes of expiry and was open
  at least twice that long, tracked by `expiry_warned_at`.

## Consequences

- The browser-derived alerts and their session store are removed. They also covered finished
  tasks and ready artifacts for everyone; durable notices now go to owners, and artifact-ready
  notices are not produced. Per-person subscriptions and preferences are Phase 5.
- The webhook is one destination per deployment for one organization (default slug `local`).
  Its origin must be in `A2A_ALLOWED_AGENT_ORIGINS`, and it cannot carry a query string.
- Delivery is at least once; receivers deduplicate on the delivery ID.
- Email, chat apps with their own APIs and per-user channels are future adapters behind the
  same port. Notification retention is not yet limited.
