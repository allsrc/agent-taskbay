/** Opaque position in the task list: the last row of a page, in `updated_at desc, id asc` order. */
export interface TaskListCursor { updatedAt: Date; id: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeTaskCursor(cursor: TaskListCursor): string {
  return Buffer.from(JSON.stringify({ updatedAt: cursor.updatedAt.toISOString(), id: cursor.id }), "utf8").toString("base64url");
}

/** Returns undefined for anything that is not a cursor this module produced. */
export function decodeTaskCursor(value: string): TaskListCursor | undefined {
  if (!value || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { updatedAt?: unknown; id?: unknown };
    if (typeof parsed.updatedAt !== "string" || typeof parsed.id !== "string" || !UUID.test(parsed.id)) return undefined;
    const updatedAt = new Date(parsed.updatedAt);
    if (Number.isNaN(updatedAt.getTime())) return undefined;
    return { updatedAt, id: parsed.id };
  } catch { return undefined; }
}
