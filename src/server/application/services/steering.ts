import type { SteeringEntry, SteeringOutcome } from "../../../shared/task-types";
import type { CommandStatus, JsonValue, TaskCommandRecord, TaskEventRecord, TaskRecord } from "../../domain/persistence-model";
import type { ArtifactStore } from "../ports/artifact-store";
import type { TaskCommandRepository, TaskEventRepository } from "../ports/persistence";
import { eventSubject, object } from "./task-projection";

/** A message sent while the task is in one of these states is "more input to running work", not a reply. */
const RUNNING = ["SUBMITTED", "WORKING"];
const plain = (state: string) => state.replace("TASK_STATE_", "");
const isUser = (role: unknown) => role === "ROLE_USER" || role === "user";
/** Commands that never reached the task are looked up from this far back, newest first. */
const UNSETTLED_LIMIT = 50;

/** What a command's own status says about the outcome, before looking at what the agent did afterwards. */
export function outcomeForCommand(status: CommandStatus): Exclude<SteeringOutcome, "responded"> | "sent" {
  if (status === "succeeded") return "sent";
  if (status === "rejected") return "refused";
  if (status === "pending" || status === "dispatching") return "waiting";
  return "unknown";
}

interface Position { state: string; seenMessages: Set<string>; seenArtifacts: Set<string> }

/** True when a ledger row shows the agent doing something it had not shown before: a new message or artifact, a state change, or any streamed update. */
function agentActivity(row: TaskEventRecord, position: Position): boolean {
  const envelope = object(row.payloadJson);
  const { kind, subject } = eventSubject((envelope.event ?? row.payloadJson) as JsonValue);
  const status = object(subject.status);
  const state = typeof status.state === "string" ? plain(status.state) : undefined;
  let active = false;
  const note = (message: unknown) => {
    const value = object(message);
    if (isUser(value.role)) return;
    const id = typeof value.messageId === "string" ? value.messageId : undefined;
    if (!id) { active = true; return; }
    if (!position.seenMessages.has(id)) active = true;
    position.seenMessages.add(id);
  };
  if (kind === "message") note(subject);
  if (status.message) note(status.message);
  if (Array.isArray(subject.history)) for (const message of subject.history) note(message);
  const artifacts = kind === "artifactUpdate" || kind === "taskArtifactUpdate" ? [object(subject.artifact)] : Array.isArray(subject.artifacts) ? subject.artifacts.map(object) : [];
  for (const artifact of artifacts) {
    const id = String(artifact.artifactId ?? "");
    if (kind !== "task" || !position.seenArtifacts.has(id)) active = true;
    position.seenArtifacts.add(id);
  }
  if (kind === "statusUpdate" || kind === "taskStatusUpdate") active = true;
  if (state !== undefined && state !== position.state) active = true;
  if (state !== undefined) position.state = state;
  return active;
}

export interface SteeringInput {
  ledger: TaskEventRecord[];
  /** Send commands by message id: the ones whose message is in the ledger. */
  commands: Map<string, TaskCommandRecord>;
  /** Commands whose message never reached the ledger, with what they carried. */
  unsettled: Array<{ command: TaskCommandRecord; taskId?: string; text?: string }>;
  remoteTaskId: string | null;
}

/**
 * Derives, at read time, what happened to each message sent to a working task. Nothing is stored (see the steering decision):
 * the command row says whether the agent accepted it, and the ledger says whether the agent showed anything afterwards.
 * Taskbay never infers that the agent used or ignored the instruction.
 */
export function computeSteering(input: SteeringInput): SteeringEntry[] {
  const ordered = [...input.ledger].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.receivedAt.getTime() - b.receivedAt.getTime() || a.id.localeCompare(b.id));
  const position: Position = { state: "", seenMessages: new Set(), seenArtifacts: new Set() };
  // The task state after each row, so a command that never reached the ledger can be placed in time.
  const timeline: Array<{ at: number; state: string }> = [];
  const found: Array<SteeringEntry & { index: number }> = [];
  const activityAfter: number[] = [];
  const delivered = new Set<string>();
  ordered.forEach((row, index) => {
    const { kind, subject } = eventSubject((object(row.payloadJson).event ?? row.payloadJson) as JsonValue);
    if (kind === "message" && isUser(subject.role)) {
      const messageId = typeof subject.messageId === "string" ? subject.messageId : "";
      const command = input.commands.get(messageId);
      if (command && !delivered.has(messageId) && RUNNING.includes(position.state)) {
        delivered.add(messageId);
        const base = outcomeForCommand(command.status);
        found.push({ messageId, commandId: command.id, sentAt: row.receivedAt.toISOString(), index,
          outcome: base === "sent" ? "delivered" : base, ...(command.status === "rejected" && command.errorKind ? { errorKind: command.errorKind } : {}) });
      }
      return;
    }
    if (agentActivity(row, position)) activityAfter.push(index);
    timeline.push({ at: row.receivedAt.getTime(), state: position.state });
  });
  const entries: SteeringEntry[] = found.map(({ index, ...entry }) => {
    if (entry.outcome === "delivered" && activityAfter.some((at) => at > index)) return { ...entry, outcome: "responded" as const };
    return entry;
  });
  // Commands that never reached the ledger: placed by the time they were created.
  for (const { command, taskId, text } of input.unsettled) {
    if (!input.remoteTaskId || taskId !== input.remoteTaskId || delivered.has(command.messageId)) continue;
    const before = [...timeline].reverse().find((point) => point.at <= command.createdAt.getTime());
    if (!before || !RUNNING.includes(before.state)) continue;
    const base = outcomeForCommand(command.status);
    if (base === "sent") continue;
    entries.push({ messageId: command.messageId, commandId: command.id, sentAt: command.createdAt.toISOString(), outcome: base,
      ...(command.status === "rejected" && command.errorKind ? { errorKind: command.errorKind } : {}), ...(text ? { text } : {}) });
  }
  return entries.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

export interface SteeringSources { events: TaskEventRepository; commands: TaskCommandRepository; store: ArtifactStore }

/** Loads what `computeSteering` needs, in a fixed number of queries plus one archived payload read per command that never reached the task. */
export async function readSteering(task: TaskRecord, sources: SteeringSources): Promise<SteeringEntry[]> {
  if (task.kind !== "task" || !task.remoteTaskId) return [];
  const ledger = await sources.events.findByTaskId(task.organizationId, task.id);
  const messageIds = new Set<string>();
  for (const row of ledger) {
    const { kind, subject } = eventSubject((object(row.payloadJson).event ?? row.payloadJson) as JsonValue);
    if (kind === "message" && isUser(subject.role) && typeof subject.messageId === "string") messageIds.add(subject.messageId);
  }
  const commands = new Map((await sources.commands.findSendsByMessageIds(task.organizationId, task.agentId, task.tenant, [...messageIds])).map((command) => [command.messageId, command]));
  const unsettled: SteeringInput["unsettled"] = [];
  for (const command of await sources.commands.listUnsettledSends(task.organizationId, task.agentId, task.tenant, task.createdAt, UNSETTLED_LIMIT)) {
    if (messageIds.has(command.messageId)) continue;
    const [organizationId, digest] = command.payloadObjectKey.split("/");
    const bytes = organizationId === task.organizationId ? await sources.store.get(organizationId, digest).catch(() => undefined) : undefined;
    if (!bytes) continue;
    let params: Record<string, unknown> = {};
    try { params = object(JSON.parse(Buffer.from(bytes).toString())); } catch { continue; }
    const text = typeof params.text === "string" && params.text.trim() ? params.text
      : (Array.isArray(params.parts) ? params.parts.map(object).find((part) => typeof part.text === "string")?.text as string | undefined : undefined);
    unsettled.push({ command, taskId: typeof params.taskId === "string" ? params.taskId : undefined, text: text?.slice(0, 2000) });
  }
  return computeSteering({ ledger, commands, unsettled, remoteTaskId: task.remoteTaskId });
}
