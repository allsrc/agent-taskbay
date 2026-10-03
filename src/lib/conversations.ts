import { taskBucket, type TaskBucket, type TrackedTask } from "../store/task-store";

/** A2A groups tasks and messages by `contextId`; a direct reply with no context stands alone under its own id. */
export const conversationKey = (task: TrackedTask) => {
  const bytes = new TextEncoder().encode(JSON.stringify([task.agentId, task.tenant ?? "", task.contextId || task.taskId]));
  const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
  return `c-${encoded.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
};

export interface Conversation {
  key: string;
  agentId: string;
  agentName: string;
  /** Oldest first: the order things happened in. */
  tasks: TrackedTask[];
  createdAt: string;
  updatedAt: string;
  /** What the conversation needs from the user right now. */
  bucket: TaskBucket;
  title: string;
}

export const isOpenTask = (task: TrackedTask) =>
  task.kind !== "message" && !["completed", "failed"].includes(taskBucket(task.state));

function conversationBucket(tasks: TrackedTask[]): TaskBucket {
  const buckets = tasks.map((task) => taskBucket(task.state));
  if (buckets.includes("needs-input")) return "needs-input";
  if (buckets.includes("in-progress")) return "in-progress";
  return buckets.at(-1) ?? "replies";
}

function conversationTitle(tasks: TrackedTask[]): string {
  const first = tasks[0]?.messages.find((message) => message.role === "user");
  const text = first?.parts.find((part) => part.kind === "text");
  return text ? String(text.value).trim().slice(0, 80) : (tasks[0]?.agentName ?? "Conversation");
}

export function groupConversations(tasks: TrackedTask[]): Conversation[] {
  const groups = new Map<string, TrackedTask[]>();
  for (const task of tasks) {
    const key = conversationKey(task);
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return [...groups.entries()]
    .map(([key, items]) => {
      const ordered = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return {
        key,
        agentId: ordered[0].agentId,
        agentName: ordered[0].agentName,
        tasks: ordered,
        createdAt: ordered[0].createdAt,
        updatedAt: ordered.map((task) => task.updatedAt).sort().at(-1) ?? ordered[0].updatedAt,
        bucket: conversationBucket(ordered),
        title: conversationTitle(ordered),
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Old unscoped chat links are accepted only when exactly one scoped context matches. */
export function findConversation(conversations: Conversation[], key: string): Conversation | undefined {
  const exact = conversations.find((conversation) => conversation.key === key);
  if (exact) return exact;
  const matches = conversations.filter((conversation) => conversation.tasks.some((task) => (task.contextId || task.taskId) === key));
  return matches.length === 1 ? matches[0] : undefined;
}
