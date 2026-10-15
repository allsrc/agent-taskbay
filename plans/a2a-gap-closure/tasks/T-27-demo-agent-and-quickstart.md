---
id: T-27
title: Demo agent and quickstart for tasks started elsewhere
phase: 2
status: done
depends_on: [T-26, T-12]
size: M
gap: dev-startup
migration: no
updated: 2026-10-15
---

# T-27. Dev startup: try browse and track in two minutes

## Goal

A new user on a laptop, with no database server and no `.env`, can try browsing and tracking a task another system started, using only `npx agent-taskbay` and `npx agent-taskbay demo-agent` (D-16, rule 5).

## Read first

- `scripts/fixture-form-agent.mjs` (it is the file shipped in the npm package and served by `demo-agent`), `bin/agent-taskbay.mjs`, `bin/launcher.mjs`, `package.json` `files`.
- `docs/quickstart.md`, `README.md` ("Try it"), `docs/reference/cli.md` (`demo-agent`), `scripts/verify-package.mjs` (what the package check proves).

## Scope

1. Add a variant to the **shipped** fixture agent (not the T-01 scenario agent, which is not packaged): `automation`. It starts with two pre-seeded tasks, as if a pipeline started them: "Rotate staging credentials" in `input-required` asking "Which environment should I rotate?" (answerable with text), and "Nightly report" `completed`. It supports `ListTasks`, `GetTask`, `SendMessage` to the input-required task (which then completes) and `CancelTask`. It is printed by `demo-agent` with its Agent Card URL.
2. Keep the package small and dependency-free; keep the existing variants unchanged. Add a unit test for the variant.
3. `docs/quickstart.md`: a second walk-through "Find a task another system started": connect the `automation` card, open the agent, **Browse tasks on this agent**, **Track** "Rotate staging credentials", answer it from the Inbox or chat, and see it complete. Commands and labels must match the built UI. Include "When it fails" (no tasks listed → agent not reachable or listing unsupported; Track disabled → role or discovery mode).
4. `README.md` "Try it": one short paragraph linking to that walk-through. Add a screenshot only if you can produce it from the running app; otherwise none.
5. Extend `scripts/verify-package.mjs` (or its launcher driving) to assert that the packed tarball's demo agent serves the `automation` card and lists two tasks. Keep the check fast.
6. Confirm in the log that the whole flow works with `npx agent-taskbay` defaults on PGlite and that nothing else was needed (profile **dev**).

## Acceptance criteria

1. From a clean directory with the packed tarball installed, the quickstart steps work exactly as written.
2. `npm run verify:package` passes and covers the new variant.
3. `demo-agent` output lists the new card URL; existing cards unchanged.
4. Docs commands were run; shown output is real.

## Tests

Unit test for the variant; `verify:package`.

## Documentation

`docs/quickstart.md`, `README.md`, `docs/reference/cli.md` (`demo-agent` output and variants), `CHANGELOG.md`.

## Out of scope

Real agents, screenshots that cannot be reproduced, any production-only setup.

## Notes for later

## Implementation log

- 2026-10-15 · done: scripts/fixture-form-agent.mjs gains the 'automation' variant (two tasks a pipeline 'started': Rotate staging credentials waiting for input, Nightly report finished; ListTasks, GetTask, SendMessage, CancelTask), printed by demo-agent; quickstart walk-through 7, README, cli.md; src/lib/fixture-automation-agent.test.ts; verify-package.mjs now registers the card from the packed install, browses, tracks and checks origin=discovered. npm run verify:package passed (packed tarball, install, launch, browse and track, restart). Whole npm run check passed on the merged tree.