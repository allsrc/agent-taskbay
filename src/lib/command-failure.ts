/** What a failed send or cancel looks like to the console: a machine-readable kind chosen by Taskbay, and a message. */
export interface CommandFailure {
  /** An A2A refusal kind, `uncertain`, or a Taskbay code such as `task_terminal`. Selects the copy; never comes from agent text. */
  kind?: string;
  message: string;
  status?: number;
  /** Extra facts from the API (for example the extensions an agent requires). Agent-supplied strings: show as text only. */
  details?: Record<string, unknown>;
}

export class CommandFailureError extends Error {
  readonly kind?: string;
  readonly status?: number;
  readonly details?: Record<string, unknown>;
  constructor(message: string, extra: { kind?: string; status?: number; details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "CommandFailureError";
    Object.assign(this, extra);
  }
}

export function failureFromError(error: unknown, fallback = "The request failed."): CommandFailure {
  if (error instanceof CommandFailureError) return { kind: error.kind, message: error.message, status: error.status, details: error.details };
  return { message: error instanceof Error && error.message ? error.message : fallback };
}

/** Reads the error body of a non-OK API response. */
export async function failureFromResponse(response: Response, fallback = "The request failed."): Promise<CommandFailure> {
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string; kind?: string; details?: Record<string, unknown> } };
  return { kind: body.error?.kind, message: body.error?.message ?? fallback, status: response.status, details: body.error?.details };
}
