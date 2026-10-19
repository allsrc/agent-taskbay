import { DatabaseOpenError } from "../adapters/db/pglite-guard";

const lastCause = new Map<string, string>();

/**
 * A worker could not reach the database and will try again. Say why, but only when the reason changes, so a database that
 * stays down is one explanation, not one line per tick. Only our own refusals are quoted; other errors are named, never
 * quoted, because a driver message can carry connection details.
 */
export function reportRetry(label: string, error: unknown): void {
  const cause = error instanceof DatabaseOpenError ? error.message : error instanceof Error ? error.name : "Error";
  if (lastCause.get(label) === cause) return;
  lastCause.set(label, cause);
  console.error(`${label} could not access durable state; will retry. ${cause}`);
}
