---
id: T-02
title: Prove the behaviors the analysis could not verify
phase: 0
status: done
depends_on: []
size: M
gap: harness
migration: no
updated: 2026-10-15
---

# T-02. Prove the unverified behaviors

## Goal

Four behaviors were judged by reading code only. Turn each into a passing test, or into a recorded defect with a follow-up note, before later tasks build on them.

## Read first

- `docs/project/a2a-gap-analysis-and-plan.md` (the rows marked Unverified).
- `src/server/application/services/versioned-task-projection.ts`, `observe-task.ts`.
- `src/server/adapters/db/security-repository.ts` (`taskAccessFilter`), `scoped-security.db.test.ts`.
- `src/components/chat/chat-view.tsx` (how `tenant` and `skillId` are chosen on send), `src/lib/run-message.ts`.

## Scope

Write tests for each question, in the layer that fits. If a test fails because of a real defect, **do not fix it here**: mark the test `it.fails` or skip it with a comment, add the defect to Notes for later with a reproduction, and tell the maintainer in the Implementation log.

| # | Question | Layer |
| --- | --- | --- |
| 1 | Do repeated status updates with the **same state** but different messages all survive projection and show in order (WF-25)? Include one with a timestamp and one without. | unit, `versioned-task-projection.test.ts` |
| 2 | When a new conversation starts, which `tenant` does Taskbay send: the agent card's interface tenant, the first task's tenant, or empty? What happens for an agent whose interfaces declare a tenant (WF-66)? | unit for the helper, plus a `run-message` test |
| 3 | A task with `skill_id = null` on an agent: is it visible to (a) admin, (b) a whole-agent grantee, (c) a skill-scoped grantee, (d) a user with no grant? Expected: a, b yes; c, d no. | db, extend `scoped-security.db.test.ts` |
| 4 | For an agent that advertises skill routing (`requiresSkill` in the chat UI), what happens when the user sends to an **existing task whose `skill_id` is null**? Today the chat passes the picker skill and the server rejects it with "Task skill cannot be changed." (`acceptCommandWithin`). Confirm. | unit for the skill-selection logic, db for the server rule |

## Acceptance criteria

1. Each of the four has a test that passes, or a clearly marked failing test plus a defect note.
2. The Implementation log states the answer to each question in one sentence.
3. `docs/project/a2a-gap-analysis-and-plan.md` is **not** edited here (T-24 removes it).

## Tests

As in the table. If new db tests go in a new file, add it to the `test:db` list in `package.json`.

## Documentation

Only if a test reveals documented behavior to be wrong: fix that page and say so in the log. Otherwise none.

## Out of scope

Fixing defects, changing behavior.

## Notes for later

## Implementation log

- 2026-10-15 · done: Q1 same-state updates: every message survives in order, with or without timestamps; transitions record one WORKING per turn when untimestamped (4 tests in versioned-task-projection.test.ts). Q2 tenant: Taskbay sends/stores '' for a new conversation and the SDK client fills the selected interface's tenant on the wire, so stored tenant and agent tenant can differ (src/lib/gateway-tenant.test.ts; carried into T-18). Q3 skill-less task visibility: admin and whole-agent grant yes; skill-scoped and no-grant no, in detail and list (skill-less-tasks.db.test.ts, added to test:db, PGlite passes; PostgreSQL runs when A2A_TEST_POSTGRES_URL is set). Q4 skill routing: requiresSkill is set only for skill-scoped principals, who cannot see skill-less tasks, so no chat defect; whole-agent send without a skill works, naming a skill is 403, others get 404 (T-11 updated).