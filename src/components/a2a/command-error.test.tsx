import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COMMAND_ERROR_COPY, CommandError } from "./command-error";

const render = (props: Parameters<typeof CommandError>[0]) => renderToStaticMarkup(<CommandError {...props} />);
const hostile = "Remote said: <script>alert(1)</script> **bold** [link](https://evil.example)";

// The repository has no browser test environment, so these check what each kind renders.
describe("CommandError", () => {
  it.each(Object.entries(COMMAND_ERROR_COPY))("%s shows its own words, whatever the agent said", (kind, copy) => {
    const html = render({ failure: { kind, message: hostile } });
    expect(html).toContain(copy.text.replaceAll("'", "&#x27;"));
    expect(html).not.toContain("<script");
    expect(html).not.toContain("Remote said");
  });

  it("covers every kind the API can return", () => {
    for (const kind of ["task_not_found", "task_not_cancelable", "push_not_supported", "unsupported_operation", "content_type_not_supported", "extended_card_not_configured",
      "extension_required", "version_not_supported", "invalid_request", "task_terminal", "uncertain", "whole_agent_required", "discovery_disabled", "listing_unsupported",
      "agent_unavailable", "agent_response_invalid", "task_not_found_on_agent", "unknown_agent"]) expect(COMMAND_ERROR_COPY[kind], kind).toBeDefined();
  });

  it("uses the message, as plain text, only when Taskbay has no words for the failure", () => {
    const html = render({ failure: { message: hostile } });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<a ");
    expect(render({ failure: { kind: "something_new", message: "Plain failure." } })).toContain("Plain failure.");
    expect(render({ failure: { message: "" } })).toContain("The request could not be completed.");
  });

  it("truncates a long message", () => {
    const html = render({ failure: { message: "x".repeat(1000) } });
    expect(html).toContain("x".repeat(300) + "…");
    expect(html).not.toContain("x".repeat(301));
  });

  it("offers Start new task only for a finished task", () => {
    expect(render({ failure: { kind: "task_terminal", message: "m" }, onStartNew: () => undefined })).toContain("Start new task");
    expect(render({ failure: { kind: "uncertain", message: "m" }, onStartNew: () => undefined })).not.toContain("Start new task");
  });

  it("offers Try again where trying again can help", () => {
    expect(render({ failure: { kind: "unsupported_operation", message: "m" }, onRetry: () => undefined })).toContain("Try again");
    expect(render({ failure: { message: "network" }, onRetry: () => undefined })).toContain("Try again");
    for (const kind of ["task_not_found", "task_not_cancelable", "task_terminal"]) expect(render({ failure: { kind, message: "m" }, onRetry: () => undefined })).not.toContain("Try again");
  });

  it("uses a danger tone for blocking problems and an info tone for finished states", () => {
    expect(COMMAND_ERROR_COPY.extension_required.tone).toBe("danger");
    expect(COMMAND_ERROR_COPY.task_terminal.tone).toBe("info");
    expect(COMMAND_ERROR_COPY.uncertain.tone).toBe("warning");
  });
});
