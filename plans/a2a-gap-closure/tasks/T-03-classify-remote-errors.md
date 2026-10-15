---
id: T-03
title: Classify errors returned by agents
phase: 1
status: done
depends_on: [T-01]
size: L
gap: G1
migration: yes
updated: 2026-10-15
---

# T-03. Classify errors returned by agents

## Goal

A definite refusal from the agent is recorded as `rejected` with a machine-readable kind, instead of `uncertain`. `uncertain` is kept only where the outcome truly is unknown.

## Read first

- [DECISIONS.md D-03](../DECISIONS.md#d-03-a2a-error-names-verified-against-a2a-jssdk-130) (the table is the spec).
- `src/lib/gateway.ts`: `executeOperation` and its protected-connection wrapper at the bottom.
- `src/server/adapters/a2a/command-gateway.ts`, `application/services/dispatch-command.ts` (`runOne` catch block), `ports/command-dispatch.ts`.
- `src/server/runtime/commands.ts`: `waitForCommand`, `legacyCommandResponse`, `commandView`.
- `src/server/adapters/db/entities.ts` and the baseline migration: is there a check constraint on `task_commands.status`?
- `node_modules/@a2a-js/sdk/dist/errors/index.js` and `index.d.ts`.

## Scope

1. **Port.** New `src/server/application/ports/remote-errors.ts`:

   ```ts
   export type RemoteErrorKind =
     | "task_not_found" | "task_not_cancelable" | "push_not_supported" | "unsupported_operation"
     | "content_type_not_supported" | "extended_card_not_configured" | "extension_required"
     | "version_not_supported" | "invalid_request";
   export class RemoteRejection extends Error {
     constructor(readonly kind: RemoteErrorKind, readonly code: number | string) { super(`Agent rejected the request: ${kind}.`); }
   }
   ```

   The message is **fixed text built from the kind**; the agent's own message is never copied into `Error.message` or `lastError`.
2. **Mapping.** A pure function `classifyRemoteError(error: unknown): RemoteErrorKind | undefined` in `src/server/adapters/a2a/remote-error-map.ts`. Order: `error.reason` (string), then `error.name`, then `error.envelopeCode` (number), per the D-03 table. `InvalidAgentResponseError`, `-32603`, unknown shapes and network errors return `undefined`.
3. **Gateway wrapper.** In `src/lib/gateway.ts`, the protected-connection catch (`secretValues` present) must also copy `reason` and, for REST errors, `statusCode`, onto the safe error. It must not copy `message`.
4. **Command gateway.** `SdkCommandGateway.dispatch`: if `dispatched` and `classifyRemoteError` returns a kind, throw `RemoteRejection`. Otherwise rethrow as today.
5. **Dispatcher.** In `CommandDispatcher.runOne`: `RemoteRejection` settles the command `rejected`, finishes the outbox row, stores `errorKind` and the fixed message. Everything else as today.
6. **Domain.** `CommandStatus` gains `"rejected"`. `TaskCommandRecord` gains `errorKind: RemoteErrorKind | null`. Add the column (`error_kind`, nullable string, length 64) to `task_commands` with a migration (`Migration0002_CommandErrorKind` if it is the next free number) and raise `DB_SCHEMA_VERSION`. Also check whether the baseline puts a check constraint on `status`; if it does, extend it in the same migration. If the number differs from the table in [ARCHITECTURE.md](../ARCHITECTURE.md), note the real number in your Implementation log.
7. **API.** `waitForCommand` maps `rejected` to `409` with body `{ error: { message, kind } }`. `commandView` and `GET /api/commands/:id` expose `status: "rejected"` and `errorKind`. `apiError` in `src/lib/api-response.ts` passes `kind` through for `CommandError`.
8. **Retry semantics.** A `rejected` command is settled; the same idempotency key returns the same rejection. A new key creates a new command. Nothing resends automatically.

## Design notes

- `rejected` is safe to retry because the agent said it did not execute. `uncertain` is not. Keep that distinction in comments and docs.
- Reconciliation and push already handle `ListTasksUnsupported` / `PushUnsupported`; leave them alone.
- `InvalidAgentResponseError` stays `uncertain` (D-03).

## Acceptance criteria

1. Table-driven unit test covers every row of D-03, including `reason`-only, `name`-only and `envelopeCode`-only inputs, and unknown errors.
2. A protected connection (with secret values) that gets `TaskNotCancelableError` still ends `rejected` with kind `task_not_cancelable`, and no remote text appears in `last_error` or the API body.
3. DB test: a `send` against the scenario agent configured with `fail: UnsupportedOperationError` ends `rejected`, the outbox row is finished, and the command is not redispatched on the next worker pass.
4. DB test: a socket drop after dispatch still ends `uncertain`.
5. HTTP: `POST /api/agents/:id/tasks/:taskId/cancel` for a task the fixture refuses returns `409` with `error.kind = "task_not_cancelable"`.
6. Upgrade test: a database at schema version 1 migrates to the new version without data loss (`npm run db:migrate`, `npm run db:schema:check`).

## Tests

- Unit: `remote-error-map.test.ts`, `gateway` wrapper test (extend the existing `executeOperation` tests if present).
- DB: extend `commands.db.test.ts`; add a migration test following `migration-startup.db.test.ts`.
- HTTP: add a case to `scripts/verify-task-http.mjs` using the T-01 scenario agent.

## Documentation

- `docs/reference/http-api.md`: command status `rejected`, `errorKind`, the `409` body with `kind`, and the list of kinds with one line each.
- `docs/reference/data-model.md`: `task_commands.status` values and `error_kind`.
- `docs/operations/troubleshooting.md`: new rows for "Agent rejected the request" with each kind and what to do.
- `docs/concepts/durable-tasks.md`: where it says uncertain outcomes are never resent, add the rejected case.
- `CHANGELOG.md`: Changed.

## Out of scope

User-facing copy and components (T-04). Terminal guard (T-05). Required extensions (T-06).

## Notes for later

## Implementation log

- 2026-10-15 · done: Migration0003_CommandErrorKind.js (task_commands.error_kind), DB_SCHEMA_VERSION=3. ports/remote-errors.ts, adapters/a2a/remote-error-map.ts (reason, then name, then envelopeCode; also standard JSON-RPC -32700/-32600/-32601/-32602, recorded in D-03), gateway protected wrapper keeps reason and statusCode, SdkCommandGateway throws RemoteRejection, dispatcher settles 'rejected', waitForCommand/CommandError/apiError carry kind, approvals map a rejected delivery to failed. Tests: remote-error-map.test.ts, command-gateway.test.ts (open and protected connections against the scenario agent), commands.db.test.ts (rejected, idempotent, outbox finished, no redispatch), verify-task-http.mjs (409 with kind, no agent text) — all passing; lint, tsc, npm test (355), test:db (21 files) green; npm run build ok. Docs: http-api, data-model, troubleshooting, durable-tasks, glossary, running-and-workers, CHANGELOG. Environment: ran npm install to restore the missing dompurify dependency (lockfile unchanged), which fixed the earlier tsc/test import failures. Not run: PostgreSQL profile (A2A_TEST_POSTGRES_URL unset).