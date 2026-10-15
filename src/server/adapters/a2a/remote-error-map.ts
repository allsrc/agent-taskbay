import type { RemoteErrorKind } from "../../application/ports/remote-errors";

/**
 * Maps an error thrown by `@a2a-js/sdk` to a definite refusal by the agent, or to nothing when the outcome is unknown.
 * The JSON-RPC code is the most specific fact, so it is read first: the SDK folds -32700, -32600 and -32601 into `RequestMalformedError`
 * (reason `INVALID_PARAMS`), which would hide that the method does not exist. Then `reason` (every A2AError has one, JSON-RPC and REST alike), then the class name.
 * `InvalidAgentResponseError` and the JSON-RPC internal error are not refusals: the agent may have acted, so they map to nothing.
 */
const BY_REASON: Record<string, RemoteErrorKind> = {
  TASK_NOT_FOUND: "task_not_found", TASK_NOT_CANCELABLE: "task_not_cancelable", PUSH_NOTIFICATION_NOT_SUPPORTED: "push_not_supported",
  UNSUPPORTED_OPERATION: "unsupported_operation", CONTENT_TYPE_NOT_SUPPORTED: "content_type_not_supported",
  EXTENDED_AGENT_CARD_NOT_CONFIGURED: "extended_card_not_configured", EXTENSION_SUPPORT_REQUIRED: "extension_required",
  VERSION_NOT_SUPPORTED: "version_not_supported", INVALID_PARAMS: "invalid_request",
};
const BY_NAME: Record<string, RemoteErrorKind> = {
  TaskNotFoundError: "task_not_found", TaskNotCancelableError: "task_not_cancelable", PushNotificationNotSupportedError: "push_not_supported",
  UnsupportedOperationError: "unsupported_operation", ContentTypeNotSupportedError: "content_type_not_supported",
  ExtendedAgentCardNotConfiguredError: "extended_card_not_configured", ExtensionSupportRequiredError: "extension_required",
  VersionNotSupportedError: "version_not_supported", RequestMalformedError: "invalid_request",
};
const BY_CODE: Record<number, RemoteErrorKind> = {
  [-32001]: "task_not_found", [-32002]: "task_not_cancelable", [-32003]: "push_not_supported", [-32004]: "unsupported_operation",
  [-32005]: "content_type_not_supported", [-32007]: "extended_card_not_configured", [-32008]: "extension_required",
  [-32009]: "version_not_supported",
  // Standard JSON-RPC errors the agent returns before running anything.
  [-32700]: "invalid_request", [-32600]: "invalid_request", [-32601]: "unsupported_operation", [-32602]: "invalid_request",
};
/** Transport-specific subclasses carry a prefix: `RestTaskNotFoundError`. */
const bareName = (name: string) => name.replace(/^(Rest|JsonRpc)(?=[A-Z])/, "");

export function classifyRemoteError(error: unknown): { kind: RemoteErrorKind; code: number | string } | undefined {
  if (!error || typeof error !== "object") return undefined;
  const { reason, name, envelopeCode } = error as { reason?: unknown; name?: unknown; envelopeCode?: unknown };
  if (typeof envelopeCode === "number" && BY_CODE[envelopeCode]) return { kind: BY_CODE[envelopeCode], code: envelopeCode };
  if (typeof reason === "string" && BY_REASON[reason]) return { kind: BY_REASON[reason], code: reason };
  if (typeof name === "string" && BY_NAME[bareName(name)]) return { kind: BY_NAME[bareName(name)], code: bareName(name) };
  return undefined;
}
