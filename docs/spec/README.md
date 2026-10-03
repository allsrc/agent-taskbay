# Specification index

This directory makes development resumable without relying on chat history.

## Authority order

When documents disagree, use this order:

1. `AGENTS.md` — repository execution rules.
2. `docs/spec/PRODUCT_SPEC.md` — product requirements and non-goals.
3. Accepted ADRs in `docs/adr/` — architectural decisions.
4. `ARCHITECTURE.md` and `docs/spec/DATA_MODEL.md` — target design.
5. `docs/spec/PHASES.md` — deliverables and exit criteria.
6. `docs/spec/STATUS.md` — current execution position.
7. `ROADMAP.md` — phase-level summary.
8. `README.md` — user-facing project description.

If a lower-level document must change a higher-level contract, update the
higher-level document and create or supersede an ADR in the same change.

## Meaning of status

- `Planned`: specified but no required slice is verified.
- `In progress`: at least one slice is being implemented or verified.
- `Blocked`: progress requires a recorded external decision or dependency.
- `Complete`: every exit criterion has dated verification evidence.

Only `docs/spec/STATUS.md` declares the active phase.

## How to resume work

When the request is “start implementing the next phase”:

1. Read the documents listed in `AGENTS.md`.
2. Open `docs/spec/STATUS.md` and select the first unchecked slice in the
   active phase.
3. Confirm prerequisites and relevant ADRs.
4. Implement the smallest end-to-end slice that changes usable behavior.
5. Add tests and run the checks named by the phase.
6. Record evidence in `STATUS.md`; check phase items only after verification.
7. If all exit criteria pass, mark the phase complete and activate the next
   phase in the same documentation change.

Do not start several phases merely because their schemas are related. It is
valid to introduce a field needed later, but the slice must satisfy the active
phase's acceptance criteria.

## Requirement traceability

Requirements have stable IDs in `PRODUCT_SPEC.md`. Phase specifications map
deliverables to those IDs. Tests should mention the relevant ID in the test
name or nearby comment when the relationship is not obvious.

## Architectural decisions

ADRs use `Proposed`, `Accepted`, `Superseded`, or `Rejected`. Accepted ADRs are
binding until another ADR explicitly supersedes them. Implementation details
that do not affect a cross-cutting decision do not need an ADR.
