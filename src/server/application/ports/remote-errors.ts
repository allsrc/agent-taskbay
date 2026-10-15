/**
 * Why an agent refused a request. Every kind means the agent said it did not carry the request out, so it is safe to send again
 * (with a new idempotency key). An outcome Taskbay cannot classify stays `uncertain` and is never resent automatically.
 */
export const REMOTE_ERROR_KINDS = [
  "task_not_found", "task_not_cancelable", "push_not_supported", "unsupported_operation", "content_type_not_supported",
  "extended_card_not_configured", "extension_required", "version_not_supported", "invalid_request",
] as const;
export type RemoteErrorKind = (typeof REMOTE_ERROR_KINDS)[number];

export const isRemoteErrorKind = (value: unknown): value is RemoteErrorKind =>
  typeof value === "string" && (REMOTE_ERROR_KINDS as readonly string[]).includes(value);

/** Thrown by a gateway when the agent returned a definite A2A error. The message is fixed text; the agent's own text is never copied into it. */
export class RemoteRejection extends Error {
  constructor(readonly kind: RemoteErrorKind, readonly code: number | string) {
    super(`Agent rejected the request: ${kind}.`);
    this.name = "RemoteRejection";
  }
}
