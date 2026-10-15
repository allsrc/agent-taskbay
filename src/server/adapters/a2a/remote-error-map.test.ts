import { describe, expect, it } from "vitest";
import { classifyRemoteError } from "./remote-error-map";

const sdk = (name: string, reason: string, envelopeCode?: number) => Object.assign(new Error("agent text"), { name, reason, ...(envelopeCode ? { envelopeCode } : {}) });

describe("classifyRemoteError", () => {
  // Names, reasons and codes are those of @a2a-js/sdk/errors 1.3.0.
  it.each([
    ["TaskNotFoundError", "TASK_NOT_FOUND", -32001, "task_not_found"],
    ["TaskNotCancelableError", "TASK_NOT_CANCELABLE", -32002, "task_not_cancelable"],
    ["PushNotificationNotSupportedError", "PUSH_NOTIFICATION_NOT_SUPPORTED", -32003, "push_not_supported"],
    ["UnsupportedOperationError", "UNSUPPORTED_OPERATION", -32004, "unsupported_operation"],
    ["ContentTypeNotSupportedError", "CONTENT_TYPE_NOT_SUPPORTED", -32005, "content_type_not_supported"],
    ["ExtendedAgentCardNotConfiguredError", "EXTENDED_AGENT_CARD_NOT_CONFIGURED", -32007, "extended_card_not_configured"],
    ["ExtensionSupportRequiredError", "EXTENSION_SUPPORT_REQUIRED", -32008, "extension_required"],
    ["VersionNotSupportedError", "VERSION_NOT_SUPPORTED", -32009, "version_not_supported"],
    ["RequestMalformedError", "INVALID_PARAMS", -32602, "invalid_request"],
  ])("%s is a refusal (%s)", (name, reason, code, kind) => {
    expect(classifyRemoteError(sdk(name, reason, code))).toMatchObject({ kind });
    // Each identifier alone is enough.
    expect(classifyRemoteError({ reason })).toMatchObject({ kind });
    expect(classifyRemoteError({ name })).toMatchObject({ kind });
    expect(classifyRemoteError({ envelopeCode: code })).toMatchObject({ kind });
  });

  it("understands the transport-prefixed class names", () => {
    expect(classifyRemoteError({ name: "RestTaskNotFoundError" })).toMatchObject({ kind: "task_not_found" });
    expect(classifyRemoteError({ name: "JsonRpcTaskNotCancelableError" })).toMatchObject({ kind: "task_not_cancelable" });
  });

  it("treats standard JSON-RPC protocol errors as refusals", () => {
    expect(classifyRemoteError({ envelopeCode: -32601 })).toMatchObject({ kind: "unsupported_operation" });
    expect(classifyRemoteError({ envelopeCode: -32600 })).toMatchObject({ kind: "invalid_request" });
    expect(classifyRemoteError({ envelopeCode: -32700 })).toMatchObject({ kind: "invalid_request" });
  });

  it("does not call an outcome a refusal when the agent may have acted", () => {
    expect(classifyRemoteError(sdk("InvalidAgentResponseError", "INVALID_AGENT_RESPONSE", -32006))).toBeUndefined();
    expect(classifyRemoteError({ envelopeCode: -32603 })).toBeUndefined();
    expect(classifyRemoteError(new Error("socket hang up"))).toBeUndefined();
    expect(classifyRemoteError(new Error("HTTP error for SendMessage! Status: 500"))).toBeUndefined();
    for (const value of [undefined, null, "TaskNotFoundError", 42]) expect(classifyRemoteError(value)).toBeUndefined();
  });

  it("reads the JSON-RPC code before the reason, because the SDK folds three codes into RequestMalformedError", () => {
    // What the SDK really throws for a method the agent does not have: RequestMalformedError, reason INVALID_PARAMS, code -32601.
    expect(classifyRemoteError({ name: "RequestMalformedError", reason: "INVALID_PARAMS", envelopeCode: -32601 })).toMatchObject({ kind: "unsupported_operation" });
    expect(classifyRemoteError({ name: "RequestMalformedError", reason: "INVALID_PARAMS", envelopeCode: -32600 })).toMatchObject({ kind: "invalid_request" });
  });
  it("prefers the reason over a conflicting class name", () => {
    expect(classifyRemoteError({ reason: "TASK_NOT_FOUND", name: "UnsupportedOperationError" })).toMatchObject({ kind: "task_not_found" });
  });
});
