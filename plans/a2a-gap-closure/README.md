# A2A gap closure: how to work on this plan

> Who this is for: any engineer or coding agent picking up one task, in a fresh conversation, with no memory of earlier ones. You will know what to read, how to take a task, what "done" means, and how to record it.

This directory is a **temporary working plan**. It is not linked from `docs/` or `README.md`, it is not published to npm (`package.json` `files` is an allow-list), and the last task (T-24) deletes it. Nothing in the product documentation may link here or mention task IDs, phases or this plan ([documentation rule 7](../../docs/contributing/documentation.md#style-rules)).

## What this plan delivers

Closes the gaps found by checking Taskbay against the A2A v1.0 workflow reference (WF-01 to WF-74). Background and the original analysis: [docs/project/a2a-gap-analysis-and-plan.md](../../docs/project/a2a-gap-analysis-and-plan.md).

| Theme | Outcome | Tasks |
| --- | --- | --- |
| Harness | A scenario agent and tests so every behavior can be proven | T-01, T-02 |
| Correct failures | Agent errors are classified; terminal tasks and unsupported required extensions are refused up front | T-03 to T-06 |
| Finding work started elsewhere | Browse an agent's tasks live (nothing stored), **track** one, then answer, steer or cancel it. Automatic discovery is opt-in per agent. A dev-startup demo makes it tryable in two minutes. | T-07 to T-12, T-25 to T-27 |
| Steering and contexts | Filters, context views, steering outcome, "stop and restart with this instruction" | T-13 to T-16 |
| Richer agent data | Extended Agent Card, connection details, related tasks, assisted cancel, push cleanup, remote history | T-17 to T-22 |
| Close-out | Roadmap entries (`auth-required`, signed push), doc consolidation, deleting this plan | T-23, T-24 |

`auth-required` handling and signed push verification are **not** built here. They are recorded as roadmap work in T-23 ([D-01, D-17](DECISIONS.md)).

## Files

| File | Read it when |
| --- | --- |
| [DECISIONS.md](DECISIONS.md) | Always, once. Settled choices; do not reopen them without new information. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Always, once. Codebase map, layer-by-layer changes, data model and migration order, security. |
| [UI-DESIGN.md](UI-DESIGN.md) | Before any task that touches a screen. |
| [TRACKER.md](TRACKER.md) | To see state. Generated; never edit it by hand. |
| `tasks/T-xx-*.md` | One per task. The only file that defines the work. |
| `tracker.mjs` | To list, start and close tasks. |

## Taking a task

1. Read, in order: `AGENTS.md` (repository root), [DECISIONS.md](DECISIONS.md), [ARCHITECTURE.md](ARCHITECTURE.md), then your task file. Read [UI-DESIGN.md](UI-DESIGN.md) if the task has a UI section. Read [docs/contributing/development.md](../../docs/contributing/development.md) and [docs/contributing/documentation.md](../../docs/contributing/documentation.md).
2. This repository's Next.js has breaking changes. Before changing any Next.js code (routes, pages, layouts), read the relevant guide in `node_modules/next/dist/docs/`.
3. Find work and check state:

   ```bash
   node plans/a2a-gap-closure/tracker.mjs next
   ```

4. Start it. This refuses if a dependency is not done, and refuses a second migration task at the same time:

   ```bash
   node plans/a2a-gap-closure/tracker.mjs set T-03 in_progress
   ```

5. Work on a branch named `plan/T-03-short-slug`. Make the changes in the task's **Scope**, nothing else. If you find something outside the scope that needs fixing, add a line to the task's **Notes for later** instead of fixing it.
6. Verify against the task's **Acceptance criteria** one by one.
7. Finish (see [Definition of done](#definition-of-done)):

   ```bash
   node plans/a2a-gap-closure/tracker.mjs set T-03 done --note "branch plan/T-03-short-slug, tests: a, b"
   ```

If you cannot finish, set `blocked` with a `--note` that says exactly what is missing. Do not leave a task `in_progress` when you stop.

Do not commit or open a pull request unless the person you work for asks. If asked, follow the repository's commit style (one short sentence ending in a period) and put the task ID in the branch name and pull request title, not in the commit subject or the docs.

## Definition of done

A task is done only when **all** of these hold. Say so in the task's Implementation log; do not tick what you did not do.

1. Every acceptance criterion is met and has a test or a command that shows it.
2. Tests are at the right layer ([Development setup](../../docs/contributing/development.md#check-your-change)): unit (`*.test.ts`), database (`*.db.test.ts`, **and added to the explicit file list in the `test:db` script**), or HTTP (`scripts/verify-*-http.mjs`, **and added to the `test:http` chain**).
3. Docs are updated according to the table in `docs/contributing/documentation.md`, plus the pages the task lists. A new page follows the style rules (audience line, limits early, failure paths, 2 to 5 Related links, relative links that resolve). Run the broken-link one-liner from that page.
4. `CHANGELOG.md` has an `Unreleased` entry for anything a user can see.
5. Security-relevant changes (credentials, outbound requests, webhooks, authorization, new stored data about people) update `docs/security/threat-model.md` and include a regression test.
6. `npm run check` passes. If it cannot run here, say so and list what you ran instead. Never report a failing check as passing.
7. **Hosting profiles** ([ARCHITECTURE.md](ARCHITECTURE.md#hosting-profiles), D-16): the change works in dev (PGlite, embedded workers), self-hosted and enterprise (PostgreSQL, several instances, separate workers). Say in the log which of the nine rules apply and how you checked them. DB tests cover both databases when `A2A_TEST_POSTGRES_URL` is set, and any new table or query is tested with two organizations.
8. The task's **Implementation log** says what changed, which files, and any deviation from the spec with the reason.
9. The tracker is updated with `set <id> done`.

## Documentation quality bar

These docs ship to open-source users, so each doc change must:

- Describe behavior the reader can observe, with defaults, ranges and error shapes. Verify every command and example you write; paste real output only if you ran it.
- State limits and failure paths, not only the happy path.
- Match existing tone: plain, short sentences, active voice, no marketing words, pre-1.0 stated where it matters.
- Keep real names (`A2A_` environment variables, route paths, JSON field names).
- Use the UI labels exactly as built, with the vocabulary in [DECISIONS.md D-04](DECISIONS.md).
- Not mention this plan.

## Rules that apply to every task

- Hosting ([ARCHITECTURE.md](ARCHITECTURE.md#hosting-profiles)): no process-memory state, safe with several instances, `organization_id` on everything, rolling-upgrade-safe migrations, dev still one command.
- Layering ([ARCHITECTURE.md](ARCHITECTURE.md#layering)): domain and application code never import React, Next.js or MikroORM. New persistence goes behind a port with an adapter.
- Migrations are numbered and additive. Take the next free number when you start; raise `DB_SCHEMA_VERSION` in the same change; never edit a released migration. Tasks marked `migration: yes` run one at a time.
- Agent-supplied text is untrusted. It renders through the existing safe renderers and is never treated as instructions, HTML or a URL to fetch.
- Every user action that reaches an agent is an idempotent command. Never resend automatically after an uncertain outcome.
- Browser code never receives agent credentials.
- UI uses design tokens and existing primitives only ([UI-DESIGN.md](UI-DESIGN.md#rules)). Check phone width.

## Task file format

```text
---
id: T-03
title: Classify errors returned by agents
phase: 1
status: todo            # todo | in_progress | blocked | done | dropped (change with tracker.mjs)
depends_on: [T-01]
size: M                 # S under a day, M one to two days, L three or more; split an L if you can
gap: G1
migration: no           # yes if it adds a migration
updated:
---
```

Sections: Goal, Read first, Scope, Design, Acceptance criteria, Tests, Documentation, Out of scope, Notes for later, Implementation log.

## Related

- [DECISIONS.md](DECISIONS.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [UI-DESIGN.md](UI-DESIGN.md)
- [TRACKER.md](TRACKER.md)
