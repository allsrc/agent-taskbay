---
id: T-23
title: Consolidate the docs and record roadmap items
phase: 5
status: todo
depends_on: [T-12, T-14, T-16, T-17, T-18, T-20, T-21, T-22, T-27]
size: M
gap: docs
migration: no
updated:
---

# T-23. Documentation consolidation and roadmap

## Goal

After the features land, the published docs read as one coherent product description with no trace of this plan, the compatibility and status pages reflect reality, and `auth-required` is recorded as planned work (D-01).

## Read first

- `docs/contributing/documentation.md` (all rules), `docs/project/status-and-roadmap.md`, `docs/reference/compatibility.md`, `docs/README.md`.
- [DECISIONS.md D-01](../DECISIONS.md) and the G4 design sketch in `docs/project/a2a-gap-analysis-and-plan.md`.
- `git log --oneline` since the plan began, and every task's Implementation log.

## Scope

1. **Roadmap entries.** In `docs/project/status-and-roadmap.md`, under the planned section, add two items. (a) Signed push notifications: the SDK sender does not sign, so Taskbay verifies a per-registration bearer token; signed-JWT verification waits for evidence that non-SDK agents need it. (b) `auth-required` handling: what works today (state shown, reply to resume), what is missing, and the intended approach in plain words (an agent-supplied authorization link shown as text with an explicit open action, an explicit "resume" message, faster recheck, no credential ever passing through Taskbay). No dates. Link issue #1.
2. **Compatibility table.** Update `docs/reference/compatibility.md`: Extended Agent Card, ListTasks usage (discovery), push verification modes, required extensions, error classification, tenant behavior, the known-limitations table (remove rows this plan resolved, add new known limits discovered: same-agent-only related links, discovery caps, no auth-required handling).
3. **Status.** Move completed capabilities to "Works today" with their proving npm scripts; list partial items honestly.
4. **Concept pages.** Read `docs/concepts/*.md` end to end and fix any statement that is now false or incomplete (for example "Taskbay only tracks tasks it started").
5. **Glossary and indexes.** Every new term is in `docs/reference/glossary.md`; `docs/README.md` lists every new guide by reader question.
6. **CHANGELOG.** Group the `Unreleased` entries so each user-visible feature is one clear line under Added or Changed. Browse and track is the headline; automatic discovery is opt-in.
7. **Sweep for plan leakage.** `grep -rniE "T-[0-9]{2}|gap-closure|phase [0-9]|G[0-9]+\b" docs README.md CHANGELOG.md` must return nothing from this plan (existing unrelated hits are fine; judge each).
8. **Link check.** Run the broken-link one-liner from `docs/contributing/documentation.md`.

## Acceptance criteria

1. All eight scope items done and listed in the log.
2. The link check and the leakage grep are clean.
3. `npm run check` passes.
4. A reader who has only the docs can find: how to connect an agent, what discovery does and how to turn it off, how errors are shown, and what is planned.

## Tests

Docs only; run the checks above.

## Documentation

This task is the documentation.

## Out of scope

New behavior.

## Notes for later

## Implementation log
