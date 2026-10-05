// Reference A2A agent for the structured-form extension (ADR 0020). It is a verification fixture, not product code:
//   node scripts/fixture-form-agent.mjs [port]      serves http://127.0.0.1:<port>/<variant>/card.json
// Variants: `form` advertises the extension, `plain` sends the same form without advertising it, `invalid` advertises it
// but sends a schema outside the supported subset. Tests import startFormAgent() to run one in-process.
import { createServer } from "node:http";

export const FORM_EXTENSION_URI = "https://a2a-ops.dev/extensions/structured-form/v1";
export const FORM_MEDIA_TYPE = "application/vnd.a2a-ops.form+json";

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
const invalidForm = { title: "Nested", schema: { type: "object", properties: { nested: { type: "object", properties: {} } } } };

export async function startFormAgent(port = 0) {
  const received = [];
  let origin = "";
  const server = createServer(async (request, response) => {
    const variant = request.url.split("/")[1];
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET") {
      response.end(JSON.stringify({
        name: `Form fixture (${variant})`, description: "Asks for input with a structured form", version: "1.0.0",
        supportedInterfaces: [{ url: `${origin}/${variant}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
        capabilities: { streaming: true, extensions: variant === "plain" ? [] : [{ uri: FORM_EXTENSION_URI, required: false }] },
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
      ...(parts || text ? { message: { messageId: `agent-${taskId}-${state}`, role: "ROLE_AGENT", parts: parts ?? [{ text }] } } : {}) } });
    if (!["SendMessage", "SendStreamingMessage"].includes(rpc.method)) {
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: `Unsupported ${rpc.method}` } }));
      return;
    }
    received.push({ variant, message });
    const reply = message.parts?.find((part) => part.data !== undefined);
    const events = reply
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
  return { origin, received, cardUrl: (variant) => `${origin}/${variant}/card.json`, close: () => new Promise((resolve) => server.close(resolve)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const agent = await startFormAgent(Number(process.argv[2] ?? 4010));
  for (const variant of ["form", "plain", "invalid"]) console.log(agent.cardUrl(variant));
}
