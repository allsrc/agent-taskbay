---
id: T-24
title: Remove the plan and its analysis page
phase: 5
status: todo
depends_on: [T-23]
size: S
gap: docs
migration: no
updated:
---

# T-24. Close out

## Goal

Leave the repository as if the plan had never been a directory: no planning files, no dangling links.

## Read first

- [README.md](../README.md) "Files".
- `docs/README.md` (the link to the analysis page), `docs/project/a2a-gap-analysis-and-plan.md`.

## Scope

1. Confirm with the maintainer that every task is `done` or `dropped` (`node plans/a2a-gap-closure/tracker.mjs list`). Anything `dropped` must have a reason in its log; move each reason into `docs/project/status-and-roadmap.md` if the limit still exists.
2. Delete `docs/project/a2a-gap-analysis-and-plan.md` and its link in `docs/README.md`. Its still-true content now lives in `docs/reference/compatibility.md` and `docs/project/status-and-roadmap.md` (T-23).
3. Delete `plans/a2a-gap-closure/` entirely (and `plans/` if empty).
4. Run the broken-link one-liner and `grep -rn "gap-closure\|a2a-gap-analysis" .` excluding `node_modules` and `.next`; both must be clean.
5. `npm run check` passes.

## Acceptance criteria

1. The paths in Scope 2 and 3 no longer exist.
2. No reference to them remains.
3. `npm run check` passes.

## Tests

None beyond `npm run check`.

## Documentation

`docs/README.md` index. Nothing else.

## Out of scope

Anything else.

## Notes for later

## Implementation log
