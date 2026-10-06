# ADR 0017: Workflow audit trail

- Status: Accepted
- Date: 2026-10-05
- Requirements: AUD-001, AUD-002, SEC-004, HITL-004

## Context

ADRs 0015 and 0016 record approvals and ownership in immutable rows and also write audit
facts. Phase 4 requires that the audit record alone identifies who decided exactly what
and when. The audit table carries only an action and a target ID, so the full answer lives
in the domain rows.

## Decision

- The audit trail is a read-only, newest-first timeline built by one query over the
  sources of truth: approval requests, revisions and decisions (with the exact content,
  revision digest, rationale, reviewer and delivery result), ownership events, note
  existence, and every other audit fact (identity, access, catalog, credentials, sent
  messages). Expiry and supersession come from their audit facts. Audit facts that a
  domain row already represents are not repeated, and an edit's revision is covered by the
  edit decision. A database test cross-checks the two so a missing or invented entry fails.
- Immutability is enforced in the database: audit facts are append-only (no update or
  delete), and an approval request's identity and proposal (task, agent, scope, title,
  summary, risk, policy, requester, expiry, creation time) cannot change; only status,
  assignment, current revision and bookkeeping can. Revisions, decisions, ownership events
  and notes were already immutable.
- Access: the organization-wide trail is for administrators. Any member who can read a
  task may read that task's trail, which excludes identity, access and credential facts;
  without a read grant the task does not exist for them (404). Another organization's
  records are unreachable. Note text is never part of the trail, only that a note was
  added, by whom and when.
- Reads are keyset-paged by (time, key) in a read-only transaction, filterable by task,
  group, actor and time range, and bounded to 200 rows. Reading writes nothing.
- Administrators can download one page of the filtered trail as CSV (`X-Next-Cursor`
  continues). Cells that begin with a spreadsheet formula character are neutralized, the
  response is an attachment with `nosniff`, and it contains only what the page shows.
- The UI is a read-only Audit page (administrators), an Audit card on each task, and a link
  from each approval. There are no mutation routes for the trail.

## Consequences

- The timeline is computed per request with a union over indexed tables; very large
  organizations need an audit projection (Phase 7) and cursor-based export beyond one page.
- Retention and deletion of audit facts (Phase 7) must use a controlled maintenance path
  because the append-only trigger intentionally blocks ordinary deletes.
- Tamper evidence is database-level immutability, not cryptographic. Hash chaining or
  external anchoring is a Phase 7 option.
- Reads of the trail are not themselves audited.
