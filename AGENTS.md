<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project specification and execution protocol

This repository uses spec-driven development. Chat history is never the source
of truth for product scope, architecture, phase order, or completion.

Before planning or implementing project work, read these files in order:

1. `docs/spec/README.md` — authority order and execution rules.
2. `docs/spec/PRODUCT_SPEC.md` — product requirements and non-goals.
3. `ARCHITECTURE.md` — target boundaries, data flow, and deployment profiles.
4. `docs/spec/DATA_MODEL.md` — persistent identity and storage invariants.
5. `ROADMAP.md` — phase order and summary status.
6. `docs/spec/STATUS.md` — the current phase and next executable slice.
7. `docs/spec/PHASES.md` — detailed deliverables and exit criteria.
8. The accepted decisions in `docs/adr/` relevant to the work.

When asked to “implement the next phase” or “continue”:

1. Resolve the active phase and next unchecked slice from
   `docs/spec/STATUS.md`; do not infer it from chat history.
2. Verify prerequisite phase exit criteria before writing code.
3. Work on one vertical slice at a time and preserve the architectural ports
   defined in `ARCHITECTURE.md`.
4. Read the relevant Next.js guide from `node_modules/next/dist/docs/` before
   changing Next.js code, as required above.
5. Add or update tests in the same slice.
6. Run the verification required by the phase specification.
7. Update `docs/spec/STATUS.md` and any completed checklist in
   `docs/spec/PHASES.md` in the same change.
8. Add an ADR when a change alters an accepted architectural decision. Do not
   silently contradict an ADR.

A phase is complete only when its exit criteria are verified. Code existing is
not sufficient evidence by itself.
