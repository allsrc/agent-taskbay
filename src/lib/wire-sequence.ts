import { shortTaskId } from "./task-view";

/** One captured message on the wire: what the client sent (`out`) or an A2A event that came back (`in`). */
export interface WireEntry {
  id: number;
  /** epoch ms */
  at: number;
  dir: "out" | "in";
  /** `SendMessage`, `CancelTask`, or the event discriminator: task / statusUpdate / artifactUpdate / message. */
  kind: string;
  json: unknown;
}

export type RowTone = "send" | "state" | "artifact" | "message" | "cancel";

export interface SequenceRow {
  id: string;
  dir: "out" | "in";
  label: string;
  /** Task state (TASK_STATE_*) when the row reports one. */
  state?: string;
  detail?: string;
  tone: RowTone;
  /** ms since the turn's request went out */
  offset: number;
  /** How many wire events were folded into this row (artifact chunks). */
  count: number;
  json: unknown;
}

export interface SequenceTurn {
  turn: number;
  title: string;
  startedAt: number;
  rows: SequenceRow[];
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function firstText(parts: unknown): string | undefined {
  if (!Array.isArray(parts)) return undefined;
  for (const part of parts) if (isObj(part) && typeof part.text === "string" && part.text.trim()) return part.text.trim().slice(0, 80);
  return undefined;
}

function describeIn(entry: WireEntry): Pick<SequenceRow, "label" | "state" | "detail" | "tone"> & { artifactId?: string } {
  const body = isObj(entry.json) ? entry.json : {};
  const inner = isObj(body[entry.kind]) ? (body[entry.kind] as Obj) : {};
  if (entry.kind === "task") {
    const status = isObj(inner.status) ? inner.status : {};
    return { label: "task", state: typeof status.state === "string" ? status.state : undefined, detail: firstText(isObj(status.message) ? status.message.parts : undefined), tone: "state" };
  }
  if (entry.kind === "statusUpdate" || entry.kind === "taskStatusUpdate") {
    const status = isObj(inner.status) ? inner.status : {};
    return { label: "statusUpdate", state: typeof status.state === "string" ? status.state : undefined, detail: firstText(isObj(status.message) ? status.message.parts : undefined), tone: "state" };
  }
  if (entry.kind === "artifactUpdate" || entry.kind === "taskArtifactUpdate") {
    const artifact = isObj(inner.artifact) ? inner.artifact : {};
    const id = String(artifact.artifactId ?? "");
    return { label: "artifactUpdate", detail: String(artifact.name ?? id), tone: "artifact", artifactId: id };
  }
  if (entry.kind === "message") return { label: "message", detail: firstText(inner.parts), tone: "message" };
  return { label: entry.kind, tone: "message" };
}

/**
 * Turns the flat wire log into a request/response sequence: every outgoing
 * request opens a turn, and the events that follow are its responses.
 * Consecutive chunks of one artifact collapse into a single row.
 */
export function buildSequence(entries: WireEntry[]): SequenceTurn[] {
  const turns: SequenceTurn[] = [];
  for (const entry of entries) {
    if (entry.dir === "out" || turns.length === 0) {
      const body = isObj(entry.json) ? entry.json : {};
      const method = typeof body.method === "string" ? body.method : entry.kind;
      const turn: SequenceTurn = { turn: turns.length + 1, title: method, startedAt: entry.at, rows: [] };
      turns.push(turn);
      if (entry.dir === "out") {
        turn.rows.push({
          id: `w${entry.id}`,
          dir: "out",
          label: method,
          tone: method === "CancelTask" ? "cancel" : "send",
          detail: method === "SendMessage" ? summarizeSend(body) : undefined,
          offset: 0,
          count: 1,
          json: entry.json,
        });
        continue;
      }
    }
    const turn = turns[turns.length - 1];
    const described = describeIn(entry);
    const previous = turn.rows.at(-1);
    if (described.artifactId && previous && previous.tone === "artifact" && previous.detail === described.detail) {
      turn.rows[turn.rows.length - 1] = { ...previous, count: previous.count + 1, json: entry.json };
      continue;
    }
    turn.rows.push({ id: `w${entry.id}`, dir: "in", ...described, offset: Math.max(0, entry.at - turn.startedAt), count: 1, json: entry.json });
  }
  return turns;
}

function summarizeSend(body: Obj): string | undefined {
  const params = isObj(body.params) ? body.params : {};
  const message = isObj(params.message) ? params.message : {};
  const text = firstText(message.parts);
  const taskId = typeof message.taskId === "string" && message.taskId ? ` → ${shortTaskId(message.taskId)}` : "";
  return text ? `${text}${taskId}` : taskId.trim() || undefined;
}
