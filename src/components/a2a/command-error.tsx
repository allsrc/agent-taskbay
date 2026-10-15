import { Callout } from "@/components/patterns/data-display";
import { Button } from "@/components/ui/button";
import type { CommandFailure } from "@/lib/command-failure";

type Tone = "info" | "warning" | "danger";
interface Copy { tone: Tone; text: string }

/**
 * What a failed send or cancel means and what to do next. Only `kind` picks the words: agent-supplied text is never used for copy,
 * and the message below is shown only for failures Taskbay has no words for (its own validation, a network error).
 */
export const COMMAND_ERROR_COPY: Record<string, Copy> = {
  task_not_found: { tone: "warning", text: "The agent no longer knows this task. Start a new one." },
  task_not_cancelable: { tone: "info", text: "This task can no longer be canceled. Its current state is shown above." },
  push_not_supported: { tone: "warning", text: "This agent does not support push notifications." },
  unsupported_operation: { tone: "warning", text: "This agent does not support that action." },
  content_type_not_supported: { tone: "warning", text: "The agent does not accept that kind of content. Try text, or another file type." },
  extended_card_not_configured: { tone: "info", text: "This agent has no extended Agent Card." },
  extension_required: { tone: "danger", text: "The agent needs an extension Taskbay does not support. See the agent page." },
  version_not_supported: { tone: "danger", text: "The agent does not support this protocol version. See the agent page." },
  invalid_request: { tone: "warning", text: "The agent rejected the request as malformed." },
  task_terminal: { tone: "info", text: "This task is finished. Start a new task in the same conversation." },
  whole_agent_required: { tone: "warning", text: "You need access to the whole agent to browse or track its tasks." },
  discovery_disabled: { tone: "info", text: "Task discovery is turned off for this agent." },
  listing_unsupported: { tone: "info", text: "This agent does not support listing tasks. You can still track a task if you know its ID." },
  agent_unavailable: { tone: "warning", text: "The agent could not be reached." },
  agent_response_invalid: { tone: "warning", text: "The agent returned something Taskbay could not read." },
  task_not_found_on_agent: { tone: "warning", text: "The agent does not have a task with that ID." },
  unknown_agent: { tone: "warning", text: "This agent is not available." },
  uncertain: { tone: "warning", text: "Taskbay can't tell whether the agent received this. It will not resend automatically. Check the task before trying again." },
};
const GENERIC = "The request could not be completed.";
const MESSAGE_LIMIT = 300;

export function commandErrorCopy(failure: Pick<CommandFailure, "kind">): Copy | undefined {
  return failure.kind ? COMMAND_ERROR_COPY[failure.kind] : undefined;
}

export function CommandError({ failure, onStartNew, onRetry, className }: {
  failure: CommandFailure;
  /** Offered for a finished task: send the same message as a new task in the same conversation. */
  onStartNew?: () => void;
  onRetry?: () => void;
  className?: string;
}) {
  const copy = commandErrorCopy(failure);
  const message = failure.message.length > MESSAGE_LIMIT ? `${failure.message.slice(0, MESSAGE_LIMIT)}…` : failure.message;
  const startNew = failure.kind === "task_terminal" && onStartNew;
  const retry = !startNew && onRetry && !["task_not_found", "task_not_cancelable", "task_terminal"].includes(failure.kind ?? "");
  return (
    <Callout
      tone={copy?.tone ?? "danger"}
      className={className}
      action={startNew ? <Button size="sm" variant="outline" onClick={onStartNew}>Start new task</Button>
        : retry ? <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button> : undefined}
    >
      <p>{copy?.text ?? (message || GENERIC)}</p>
    </Callout>
  );
}
