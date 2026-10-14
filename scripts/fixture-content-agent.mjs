// Sample A2A agent that sends content under the wrong media type, the way real agents often do: Markdown or JSON as
// text/plain, JSON labelled text/html, an HTML page labelled text/markdown, and more (scripts/fixtures/mislabeled-content.json).
// It is a verification fixture, not product code:
//   node scripts/fixture-content-agent.mjs [port]      serves http://127.0.0.1:<port>/card.json
// It streams like a language-model agent (status updates, a tool call, then results). What it sends depends on the message:
//   "results" (default)  every case as its own result artifact
//   "reply"              every case as a part of the agent's final reply
//   "progress"           every case as an in-between status update, then a short reply
//   "tools"              tool calls, results, reasoning and other JSON in the shapes common frameworks use, as status updates
//   a case id            only that case, as a result artifact (for example "plain-json")
// Tests import startContentAgent() to run one in-process.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

export const MISLABELED = JSON.parse(readFileSync(new URL("./fixtures/mislabeled-content.json", import.meta.url), "utf8"));

/** Data parts as agent frameworks send them: Google ADK, OpenAI, Anthropic, Vercel AI SDK, MCP, and arbitrary JSON. */
export const DATA_SHAPES = [
  { data: { id: "adk-7f3a", name: "list_directory", args: { path: "/kb/onboarding" } }, metadata: { adk_type: "function_call" } },
  { data: { id: "adk-7f3a", name: "list_directory", response: { files: ["laptop.md", "accounts.md"] } }, metadata: { adk_type: "function_response" } },
  { data: { code: "print(len(files))", language: "PYTHON" }, metadata: { adk_type: "executable_code" } },
  { data: { outcome: "OUTCOME_OK", output: "2\n" }, metadata: { adk_type: "code_execution_result" } },
  { data: { id: "call_Qx81", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"Paris\"}" } } },
  { data: { role: "tool", tool_call_id: "call_Qx81", content: "18°C, clear" } },
  { data: { type: "thinking", thinking: "The user wants the onboarding steps, so I should read the checklist first." } },
  { data: { type: "tool_use", id: "toolu_01Ab", name: "search_docs", input: { query: "buddy schedule" } } },
  { data: { type: "tool_result", tool_use_id: "toolu_01Ab", content: "No document matches.", is_error: true } },
  { data: { type: "tool-call", toolCallId: "v-12", toolName: "lookupUser", input: { email: "a@example.com" } } },
  { data: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "read_file", arguments: { path: "README.md" } } } },
  { data: { content: [{ type: "text", text: "# Readme" }], isError: false } },
  { data: { call_id: "callid_4456", output: { rows: 3, cached: true } } },
  { data: { id: "evt_42", status: "queued", position: 3, eta: "2m", region: "eu-west-1" } },
  { data: { error: { message: "Rate limited by the search API", code: 429 } } },
  { data: [{ service: "api", replicas: 3 }, { service: "web", replicas: 2 }] },
].map((part) => ({ mediaType: "application/json", ...part }));

const FINAL = new Set(["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_INPUT_REQUIRED"]);

/** The events one message produces, in order. */
function script(taskId, contextId, said, nextId) {
  const message = (parts) => ({ messageId: nextId(), role: "ROLE_AGENT", taskId, contextId, parts });
  const status = (state, parts) => ({ statusUpdate: { taskId, contextId, status: { state, timestamp: new Date().toISOString(), ...(parts ? { message: message(parts) } : {}) } } });
  const part = (entry) => ({ text: entry.text, mediaType: entry.mediaType });
  const toolCall = status("TASK_STATE_WORKING", [{ data: { id: "call-1", name: "load_samples", args: { set: "mislabeled" } }, mediaType: "application/json", metadata: { adk_type: "function_call" } }]);
  const single = MISLABELED.find((entry) => said.includes(entry.id));
  const mode = single ? "single" : said.includes("reply") ? "reply" : said.includes("progress") ? "progress" : said.includes("tools") ? "tools" : "results";
  const asArtifact = (entry) => ({ artifactUpdate: { taskId, contextId, artifact: { artifactId: entry.id, name: entry.title, parts: [part(entry)] }, lastChunk: true } });
  if (mode === "single") return [toolCall, asArtifact(single), status("TASK_STATE_COMPLETED", [{ text: `Sent "${single.title}".` }])];
  if (mode === "reply") return [toolCall, status("TASK_STATE_COMPLETED", MISLABELED.map(part))];
  if (mode === "tools") return [...DATA_SHAPES.map((shape) => status("TASK_STATE_WORKING", [shape])), status("TASK_STATE_COMPLETED", [{ text: `Sent ${DATA_SHAPES.length} structured updates.` }])];
  if (mode === "progress") return [toolCall, ...MISLABELED.map((entry) => status("TASK_STATE_WORKING", [part(entry)])), status("TASK_STATE_COMPLETED", [{ text: `Sent ${MISLABELED.length} updates.` }])];
  return [toolCall, ...MISLABELED.map(asArtifact), status("TASK_STATE_COMPLETED", [{ text: `Sent ${MISLABELED.length} results.` }])];
}

export async function startContentAgent(port = 0, { delayMs = 150 } = {}) {
  const tasks = new Map();
  let sequence = 0;
  // Ids carry a per-process prefix, so a restarted fixture never reuses a task id the console already stored.
  const run = Date.now().toString(36);
  const nextId = () => `content-${run}-${++sequence}`;
  let origin = "";
  const snapshot = (task) => ({ id: task.id, contextId: task.contextId, status: task.status, history: task.history, artifacts: [...task.artifacts.values()] });
  const apply = (task, event) => {
    if (event.statusUpdate) {
      task.status = event.statusUpdate.status;
      if (task.status.message) task.history.push(task.status.message);
    }
    if (event.artifactUpdate) task.artifacts.set(event.artifactUpdate.artifact.artifactId, event.artifactUpdate.artifact);
    for (const listener of task.listeners) listener(event);
  };

  const server = createServer(async (request, response) => {
    if (request.url === "/card.json") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        name: "Mislabeled content fixture", description: "Sends content under the wrong media type", version: "1.0.0",
        supportedInterfaces: [{ url: `${origin}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
        capabilities: { streaming: true }, defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain", "text/markdown", "text/html", "application/json", "text/csv"],
        skills: [{ id: "samples", name: "Mislabeled samples", description: "Send results, a reply or progress with wrong media types", tags: ["fixture"], examples: ["results", "reply", "progress", "tools"] }],
      }));
      return;
    }
    let input = "";
    for await (const chunk of request) input += chunk;
    const rpc = JSON.parse(input || "{}");
    const reply = (result) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result })); };
    const fail = (code, message) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code, message } })); };
    if (rpc.method === "SendMessage") {
      const message = rpc.params.message;
      const id = `content-task-${run}-${++sequence}`;
      const task = { id, contextId: message.contextId ?? `content-context-${id}`, history: [], artifacts: new Map(), listeners: new Set(),
        status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() } };
      tasks.set(id, task);
      task.history.push({ ...message, taskId: id, contextId: task.contextId });
      const said = (message.parts ?? []).map((part) => part.text ?? "").join(" ").toLowerCase();
      script(id, task.contextId, said, nextId).forEach((event, index) => setTimeout(() => apply(task, event), delayMs * (index + 1)));
      reply({ task: snapshot(task) });
      return;
    }
    const task = tasks.get(rpc.params?.id);
    if (rpc.method === "GetTask") return task ? reply(snapshot(task)) : fail(-32001, "Task not found");
    if (rpc.method === "CancelTask") {
      if (!task) return fail(-32001, "Task not found");
      task.status = { state: "TASK_STATE_CANCELED", timestamp: new Date().toISOString() };
      return reply(snapshot(task));
    }
    if (rpc.method === "SubscribeToTask") {
      if (!task) return fail(-32001, "Task not found");
      response.setHeader("Content-Type", "text/event-stream");
      const send = (result) => response.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result })}\n\n`);
      send({ task: snapshot(task) });
      if (FINAL.has(task.status.state)) return response.end();
      const listener = (event) => {
        send(event);
        if (FINAL.has(task.status.state)) { task.listeners.delete(listener); response.end(); }
      };
      task.listeners.add(listener);
      request.on("close", () => task.listeners.delete(listener));
      return;
    }
    fail(-32601, `Unsupported ${rpc.method}`);
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, cardUrl: `${origin}/card.json`, close: () => new Promise((resolve) => server.close(resolve)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const agent = await startContentAgent(Number(process.argv[2] ?? 4011));
  console.log(agent.cardUrl);
}
