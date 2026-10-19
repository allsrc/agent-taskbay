/**
 * What each identifier in the console is. The console shows a lot of them and they look alike, so every one is labeled with a
 * plain name, the protocol field it comes from, and a sentence saying who creates it and what it is for. The A2A wording follows
 * the protocol definitions: a task id is created by the server for a new task, a context id groups a conversation's tasks and
 * messages, a message id is created by whoever sends the message, and an artifact id is unique within its task.
 */
export type IdKind = "task" | "context" | "message" | "artifact" | "reference" | "call" | "record" | "agent" | "approval" | "command" | "digest" | "tenant";

export interface IdInfo {
  /** The name shown next to the value. */
  label: string;
  /** The protocol field or Taskbay field it is, for people matching it to an agent's logs or the wire panel. */
  field: string | null;
  /** Who creates it and what it is for. */
  help: string;
  /** Whether the A2A protocol defines it, or Taskbay keeps it for its own records. */
  origin: "A2A" | "Taskbay";
}

export const ID_KINDS: Record<IdKind, IdInfo> = {
  task: { label: "Task ID", field: "taskId", origin: "A2A",
    help: "The agent's ID for one unit of work. The agent creates it when it starts a new task. Use it to find the task in the agent's own logs." },
  context: { label: "Context ID", field: "contextId", origin: "A2A",
    help: "Groups related tasks and messages into one conversation. The agent creates it with the first task, and later messages send it to continue the same conversation." },
  message: { label: "Message ID", field: "messageId", origin: "A2A",
    help: "Identifies one message. Whoever sends a message creates its ID: Taskbay for yours, the agent for its replies." },
  artifact: { label: "Artifact ID", field: "artifactId", origin: "A2A",
    help: "Identifies one output of a task, such as a file or a result. It is unique within its task, not across tasks." },
  reference: { label: "Referenced task", field: "referenceTaskIds", origin: "A2A",
    help: "An earlier task this message tells the agent to use as extra context." },
  call: { label: "Call ID", field: null, origin: "A2A",
    help: "The agent's ID for one tool call or its result, used to pair a call with its result. It comes from the agent's data part." },
  record: { label: "Taskbay ID", field: "localId", origin: "Taskbay",
    help: "Taskbay's own ID for this stored task, used in console links. It is not an A2A ID and the agent never sees it." },
  agent: { label: "Agent ID", field: null, origin: "Taskbay",
    help: "Taskbay's ID for this connected agent. It is not part of the Agent Card." },
  approval: { label: "Approval ID", field: null, origin: "Taskbay",
    help: "Taskbay's ID for this approval request." },
  command: { label: "Command ID", field: null, origin: "Taskbay",
    help: "Taskbay's durable record of one request it sent to an agent. Use it to check whether a send went through." },
  digest: { label: "Digest", field: null, origin: "Taskbay",
    help: "A SHA-256 fingerprint of the exact content. Two items with the same digest are identical." },
  tenant: { label: "Tenant", field: "tenant", origin: "A2A",
    help: "The agent's tenant, which scopes the agent's data. It comes from the Agent Card." },
};

/** Long generated IDs keep their start and end, which is what people compare. */
export function shortId(value: string, head = 8): string {
  return value.length > head + 6 ? `${value.slice(0, head)}…${value.slice(-4)}` : value;
}
