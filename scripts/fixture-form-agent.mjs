// Reference A2A agent for the structured-form extension (ADR 0020). It is a verification fixture, not product code:
//   node scripts/fixture-form-agent.mjs [port]      serves http://127.0.0.1:<port>/<variant>/card.json
// Variants: `form` advertises the extension, `plain` sends the same form without advertising it, `invalid` advertises it
// but sends a schema outside the supported subset, `showcase` advertises the form, A2UI and approval-request extensions and answers by
// message (form by default, "surface" for an A2UI surface, "approve" for an approval request), `unknown` advertises only an extension the
// console does not know and sends form, A2UI and approval parts anyway, `approver` advertises the approval-request extension and asks a person to approve an
// action (`rogue` sends the same request without advertising it),  `a2ui` advertises the A2UI v0.9 extension and asks for confirmation with a surface. Tests import startFormAgent() to run one in-process.
import { createServer } from "node:http";

export const FORM_EXTENSION_URI = "https://extensions.allsrc.dev/agent-taskbay/structured-form/v1";
export const A2UI_EXTENSION_URI = "https://a2ui.org/a2a-extension/a2ui/v0.9";
export const APPROVAL_EXTENSION_URI = "https://extensions.allsrc.dev/agent-taskbay/approval-request/v1";
export const APPROVAL_MEDIA_TYPE = "application/vnd.agent-taskbay.approval-request+json";
export const A2UI_MEDIA_TYPE = "application/a2ui+json";
const BASIC_CATALOG = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";
export const FORM_MEDIA_TYPE = "application/vnd.agent-taskbay.form+json";

const deployForm = {
  title: "Deploy request",
  description: "Choose where to deploy.",
  submitLabel: "Request deploy",
  order: ["environment", "replicas", "note", "dryRun"],
  schema: {
    type: "object",
    required: ["environment", "replicas"],
    properties: {
      environment: { type: "string", title: "Environment", enum: ["staging", "production"], enumNames: ["Staging", "Production"] },
      replicas: { type: "integer", title: "Replicas", minimum: 1, maximum: 10, default: 2 },
      note: { type: "string", title: "Note", maxLength: 200 },
      dryRun: { type: "boolean", title: "Dry run" },
    },
  },
};
const startForm = {
  title: "New deployment task",
  description: "Tell the agent what to deploy.",
  submitLabel: "Start task",
  order: ["service", "priority"],
  schema: { type: "object", required: ["service"], properties: {
    service: { type: "string", title: "Service", maxLength: 60 },
    priority: { type: "string", title: "Priority", enum: ["low", "high"], default: "low" } } },
};
const invalidForm = { title: "Nested", schema: { type: "object", properties: { nested: { type: "object", properties: {} } } } };


/** A2UI v0.9 Basic Catalog surface: bound inputs, an event button, plus components the console must degrade (Image, openUrl). */
const a2uiSurface = [
  { version: "v0.9", createSurface: { surfaceId: "deploy", catalogId: BASIC_CATALOG } },
  { version: "v0.9", updateComponents: { surfaceId: "deploy", components: [
    { id: "root", component: "Card", child: "body" },
    { id: "body", component: "Column", children: ["title", "desc", "note", "reason", "env", "notify", "sep", "confirm", "link", "img"] },
    { id: "title", component: "Text", variant: "h3", text: "Confirm deployment" },
    { id: "desc", component: "Text", text: { path: "/service" } },
    { id: "note", component: "Text", variant: "caption", text: "<b>not bold</b><img src=x onerror=window.__a2uiPwned=1>" },
    { id: "reason", component: "TextField", label: "Reason", value: { path: "/reason" } },
    { id: "env", component: "ChoicePicker", label: "Environment", variant: "mutuallyExclusive", options: [{ label: "Staging", value: "staging" }, { label: "Production", value: "production" }], value: { path: "/env" } },
    { id: "notify", component: "CheckBox", label: "Notify the team", value: { path: "/notify" } },
    { id: "sep", component: "Divider" },
    { id: "confirm", component: "Button", variant: "primary", child: "confirm_label", action: { event: { name: "confirm_deploy", context: { reason: { path: "/reason" }, env: { path: "/env" }, notify: { path: "/notify" } } } } },
    { id: "confirm_label", component: "Text", text: "Confirm" },
    { id: "link", component: "Button", child: "link_label", action: { functionCall: { call: "openUrl", args: { url: "https://evil.example/phish" } } } },
    { id: "link_label", component: "Text", text: "Open docs" },
    { id: "img", component: "Image", url: "https://evil.example/pixel.png" },
  ] } },
  { version: "v0.9", updateDataModel: { surfaceId: "deploy", path: "/", value: { service: "billing-api", env: ["staging"], notify: false } } },
];

export async function startFormAgent(port = 0) {
  const received = [];
  const cancelled = [];
  const contexts = new Map();
  let origin = "";
  const server = createServer(async (request, response) => {
    const variant = request.url.split("/")[1];
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET") {
      response.end(JSON.stringify({
        name: `Form fixture (${variant})`, description: "Asks for input with a structured form", version: "1.0.0",
        supportedInterfaces: [{ url: `${origin}/${variant}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
        capabilities: { streaming: true, extensions: variant === "unknown" ? [{ uri: "https://example.com/extensions/unknown/v9", required: false, params: { anything: true } }]
          : variant === "showcase" ? [{ uri: FORM_EXTENSION_URI, required: false, params: { startForm } }, { uri: A2UI_EXTENSION_URI, required: false }, { uri: APPROVAL_EXTENSION_URI, required: false }]
          : variant === "plain" || variant === "rogue" ? [] : variant === "approver" ? [{ uri: APPROVAL_EXTENSION_URI, required: false }] : variant === "a2ui" ? [{ uri: A2UI_EXTENSION_URI, required: false, params: { supportedCatalogIds: [BASIC_CATALOG] } }]
          : [{ uri: FORM_EXTENSION_URI, required: false, params: variant === "form" ? { startForm } : {} }] },
        defaultInputModes: ["text/plain", "application/json"], defaultOutputModes: ["text/plain"], skills: [],
      }));
      return;
    }
    let input = "";
    for await (const chunk of request) input += chunk;
    const rpc = JSON.parse(input);
    const message = rpc.params?.message;
    const taskId = message?.taskId ?? `form-task-${received.length}`;
    const contextId = message?.contextId ?? "form-context";
    const status = (state, text, parts) => ({ taskId, contextId, status: { state, timestamp: new Date().toISOString(),
      ...(parts || text ? { message: { messageId: `agent-${taskId}-${state}-${received.length}`, role: "ROLE_AGENT", parts: parts ?? [{ text }] } } : {}) } });
    if (rpc.method === "CancelTask") {
      cancelled.push(rpc.params.id);
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { id: rpc.params.id, contextId: contexts.get(rpc.params.id) ?? "form-context", status: { state: "TASK_STATE_CANCELED", timestamp: new Date().toISOString() } } }));
      return;
    }
    if (!["SendMessage", "SendStreamingMessage"].includes(rpc.method)) {
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: `Unsupported ${rpc.method}` } }));
      return;
    }
    received.push({ variant, message });
    contexts.set(taskId, contextId);
    const spoken = message.parts?.find((part) => part.text)?.text ?? "";
    // `showcase` picks a behavior per message; replies are recognized by what they carry.
    const mode = variant !== "showcase" ? variant
      : message.parts?.some((part) => part.mediaType === A2UI_MEDIA_TYPE) ? "a2ui" : message.metadata?.approval ? "approver"
      : message.taskId ? "form" : spoken.includes("surface") ? "a2ui" : spoken.includes("approve") ? "approver" : "form";
    if (mode === "approver" || mode === "rogue") {
      const approval = message.metadata?.approval;
      const asked = message.parts?.find((part) => part.text)?.text ?? "";
      const request = asked.includes("invalid") ? { title: "Bad request", risk: "extreme", action: { kind: "send_message", text: "x" } }
        : asked.includes("structured") ? { title: "Deploy to production", summary: "Agent needs a person to confirm the parameters", risk: "high", expiresInSeconds: 3600,
          action: { kind: "send_data", form: deployForm, values: { environment: "production", replicas: 2 } } }
        : { title: "Delete the staging cluster", summary: `Agent asks: ${asked}`, risk: "high", expiresInSeconds: 3600, action: { kind: "send_message", text: `Yes, ${asked}` } };
      const events = approval
        ? [{ task: { id: taskId, contextId, status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() } } },
          { statusUpdate: { ...status("TASK_STATE_COMPLETED", `Executed with approval ${approval.revisionDigest} (${message.parts.map((part) => part.text ?? JSON.stringify(part.data)).join(" ")})`), final: true } }]
        : [{ task: { id: taskId, contextId, status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() }, history: [message] } },
          { statusUpdate: { ...status("TASK_STATE_INPUT_REQUIRED", undefined, [{ text: "A person needs to approve this first." }, { data: request, mediaType: APPROVAL_MEDIA_TYPE }]), final: true } }];
      if (rpc.method === "SendMessage") {
        response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { task: { id: taskId, contextId, status: events.at(-1).statusUpdate.status, history: [message] } } }));
        return;
      }
      response.setHeader("Content-Type", "text/event-stream");
      response.end(events.map((result) => `data: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result })}\n\n`).join(""));
      return;
    }
    if (variant === "unknown") {
      const events = [{ task: { id: taskId, contextId, status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() }, history: [message] } },
        { statusUpdate: { ...status("TASK_STATE_INPUT_REQUIRED", undefined, [{ text: "Fill in the widget." },
          { data: { widget: "unknown" }, mediaType: "application/vnd.example.widget+json" }, { data: deployForm, mediaType: FORM_MEDIA_TYPE },
          { data: a2uiSurface, mediaType: A2UI_MEDIA_TYPE },
          { data: { title: "Sneaky", risk: "high", action: { kind: "send_message", text: "Yes, delete everything" } }, mediaType: APPROVAL_MEDIA_TYPE }]), final: true } }];
      if (rpc.method === "SendMessage") {
        response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { task: { id: taskId, contextId, status: events.at(-1).statusUpdate.status, history: [message] } } }));
        return;
      }
      response.setHeader("Content-Type", "text/event-stream");
      response.end(events.map((result) => `data: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result })}\n\n`).join(""));
      return;
    }
    const action = message.parts?.find((part) => part.mediaType === A2UI_MEDIA_TYPE && part.data?.action)?.data.action;
    if (mode === "a2ui") {
      const events = action
        ? [{ task: { id: taskId, contextId, status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() } } },
          { statusUpdate: { ...status("TASK_STATE_COMPLETED", `Deploy confirmed: ${action.context.reason ?? "no reason"} (${(action.context.env ?? []).join(",")}) notify=${action.context.notify}`), final: true } }]
        : [{ task: { id: taskId, contextId, status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() }, history: [message] } },
          { statusUpdate: { ...status("TASK_STATE_INPUT_REQUIRED", undefined, [{ text: "Please confirm the deployment." }, { data: a2uiSurface, mediaType: A2UI_MEDIA_TYPE }]), final: true } }];
      if (rpc.method === "SendMessage") {
        response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { task: { id: taskId, contextId, status: events.at(-1).statusUpdate.status, history: [message] } } }));
        return;
      }
      response.setHeader("Content-Type", "text/event-stream");
      response.end(events.map((result) => `data: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result })}\n\n`).join(""));
      return;
    }
    const data = message.parts?.find((part) => part.data !== undefined);
    const reply = message.taskId ? data : undefined;
    const started = !message.taskId ? data : undefined;
    const events = started
      ? [{ task: { id: taskId, contextId, status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() }, history: [message] } },
        { statusUpdate: { ...status("TASK_STATE_COMPLETED", `Started ${started.data.service} at ${started.data.priority ?? "default"} priority.`), final: true } }]
      : reply
      ? [{ task: { id: taskId, contextId, status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() } } },
        { statusUpdate: { ...status("TASK_STATE_COMPLETED", `Deploying ${reply.data.replicas} replica(s) to ${reply.data.environment}.`), final: true } }]
      : [{ task: { id: taskId, contextId, status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() }, history: [message] } },
        { statusUpdate: { ...status("TASK_STATE_INPUT_REQUIRED", undefined, [
          { text: "Where should I deploy?" },
          { data: variant === "invalid" ? invalidForm : deployForm, mediaType: FORM_MEDIA_TYPE }]), final: true } }];
    if (rpc.method === "SendMessage") {
      const last = events.at(-1);
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { task: { id: taskId, contextId, status: last.statusUpdate?.status ?? events[0].task.status, history: [message] } } }));
      return;
    }
    response.setHeader("Content-Type", "text/event-stream");
    response.end(events.map((result) => `data: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result })}\n\n`).join(""));
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, received, cancelled, cardUrl: (variant) => `${origin}/${variant}/card.json`, close: () => new Promise((resolve) => server.close(resolve)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const agent = await startFormAgent(Number(process.argv[2] ?? 4010));
  for (const variant of ["form", "plain", "invalid"]) console.log(agent.cardUrl(variant));
}
