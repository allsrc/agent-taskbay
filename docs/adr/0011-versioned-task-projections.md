# ADR 0011: Versioned task content projections and atomic rebuild

- Status: Accepted
- Date: 2026-10-03

## Decision

Replace ADR 0006's transitional contentJson writer with projector version 2.
Keep the immutable ledger and original binary archives. Store a task projection
header, ordered message rows and assembled artifact rows, all keyed by local
task and projector version. Parts contain metadata and object references, never
inline binary. Task.projectionVersion selects the active content generation;
typed Task columns remain the indexed inbox. Legacy version 1 reads remain
available until a task is ingested or explicitly rebuilt.

Ingestion appends events and derives version 2 from the task's retained ledger
inside its existing transaction and lock. Rebuild prepares the same deterministic
projection outside that lock, verifies original archive digests and regenerates
binary references through ArtifactStore, then locks and checks the captured task
version before atomically replacing rows and switching the pointer. A concurrent
write forces a retry. Readers use a single SQL snapshot for header/messages/
artifacts and the active pointer. Failed or interrupted rebuilds preserve the
previous readable generation; rebuild never dispatches commands or lifecycle
side effects and never rewrites ledger events.

The reducer uses persisted sequence for untimestamped observations and remote
timestamps to reject stale snapshots/status, including stale content. Terminal
state cannot regress. Messages deduplicate by remote identity (or normalized
content and user turn). Artifact replacements reset assembly; later complete
snapshots correct chunks. Append fallback uses payload, user turn and per-source
occurrence, merging overlapping occurrences across sources. Explicit delivery
identities preserve distinct repeated bytes within a source. Identical chunks
without shared ordering/identity cannot be perfectly disambiguated; conservative
overlap deduplication and full snapshot reconciliation are the documented policy.

## Consequences

- Rebuild is resumable by task; repeating it yields identical visible content.
- A missing/corrupt/foreign archive fails closed before activation.
- Retained events are required; historical data deleted by retention cannot be
  reconstructed. Empty ledgers are refused rather than erasing legacy content.
- Version 1 content remains readable until activation; schema rollback exports
  the active normalized content before dropping its tables. Version 2 reads never
  use transitional JSON. Ledger timestamps and task identity, not old projection content, seed
  rebuilt state.
- Full task-ledger reduction per accepted observation favors correctness in
  this slice. Incremental checkpoints and bounded retention are later scale
  optimizations; reads do not scan the ledger.
- PGlite rebuild uses its running owner through the runtime service, or an
  offline CLI while web is stopped. PostgreSQL supports an online CLI.

This extends ADR 0002 and supersedes only the transitional projector/deduplication
details of ADR 0006. Worker ownership, scoped identity and command safety remain.
