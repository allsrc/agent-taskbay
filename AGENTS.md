<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working in this repository

Start with these, in order:

1. `README.md` — what the project is and its limits.
2. `docs/README.md` — index of the documentation by reader question.
3. `docs/contributing/development.md` and `docs/contributing/documentation.md` — setup, test layers, boundaries, and which docs page to update.

Rules:

- Read the relevant docs page before changing behavior. The code is the final authority; if a page is wrong, fix it.
- Update that docs page in the same change.
- Add or adjust tests in the same change.
- Run `npm run check` before calling the work done.
- Read the relevant Next.js guide in `node_modules/next/dist/docs/` before changing Next.js code, as required above.

`docs/archive/` holds the former specs, phase plans, decision records and evidence logs. It is historical: use it for background, never as current truth, and do not edit it.
