// Controllable A2A v1.0 agent for tests and HTTP verification. It is a fixture, not product code, and is not shipped in the npm package.
//   node scripts/fixture-scenario-agent.mjs [port]      serves http://127.0.0.1:<port>/card.json (default port 4012)
// It speaks JSON-RPC at /a2a and keeps tasks in memory. Behaviors are switched at runtime with POST /__control (loopback only):
//   { seed: [{ id, contextId, state, title, updatedAt, tenant, history }] }   tasks that exist without a SendMessage
//   { advance: { id, state, message } }                                       move a task to a state and tell subscribers
//   { fail: { method, error, times? } }                                       error is an A2A error name, "InternalError" or "drop"
//   { requireExtension: uri }  { extendedCard: { skills } }  { ignoreInputWhileWorking: true }  { rejectInputWhileWorking: true }
//   { noList: true }  { tenants: ["acme"] }  { reset: true }
// GET /__state returns the tasks and the request log so tests can assert what a client sent.
import { createServer } from "node:http";

export const SCENARIO_EXTENSION_URI = "https://example.test/extensions/scenario/v1";
const TERMINAL = ["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"];
// Codes and names match @a2a-js/sdk/errors (see plans decision D-03).
const ERRORS = {
  TaskNotFoundError: [-32001, "Task not found"],
  TaskNotCancelableError: [-32002, "Task cannot be canceled"],
  PushNotificationNotSupportedError: [-32003, "Push Notification is not supported"],
  UnsupportedOperationError: [-32004, "This operation is not supported"],
  ContentTypeNotSupportedError: [-32005, "Incompatible content types"],
  InvalidAgentResponseError: [-32006, "Invalid agent response type"],
  ExtendedAgentCardNotConfiguredError: [-32007, "Extended Agent Card not configured"],
  ExtensionSupportRequiredError: [-32008, "Extension support required"],
  VersionNotSupportedError: [-32009, "Version not supported"],
  RequestMalformedError: [-32602, "Request malformed"],
  InternalError: [-32603, "Internal error"],
};
const stateName = (state) => (String(state).startsWith("TASK_STATE_") ? String(state) : `TASK_STATE_${String(state).toUpperCase().replaceAll("-", "_")}`);

class RpcError extends Error {
  constructor(name, message) { super(message ?? ERRORS[name][1]); this.rpcName = name; this.code = ERRORS[name][0]; }
}

export async function startScenarioAgent({ port = 0, behaviors = {} } = {}) {
  let origin = "";
  let counter = 0;
  let tasks = new Map();
  let log = [];
  let config = { ...behaviors };
  let failures = [];
  const subscribers = new Map();
  const pushConfigs = new Map();

  const now = () => new Date().toISOString();
  const key = (tenant, id) => `${tenant ?? ""}\u0000${id}`;
  const taskJson = (task, historyLength) => ({
    id: task.id, contextId: task.contextId,
    status: { state: task.state, timestamp: task.updatedAt, ...(task.statusMessage ? { message: task.statusMessage } : {}) },
    history: historyLength === 0 ? [] : (historyLength ? task.history.slice(-historyLength) : task.history),
    artifacts: task.artifacts, metadata: { ...(task.title ? { title: task.title } : {}), tenant: task.tenant },
  });
  const agentMessage = (task, text) => ({ messageId: `agent-${task.id}-${task.history.length}`, role: "ROLE_AGENT", taskId: task.id, contextId: task.contextId, parts: [{ text }] });
  const emit = (task, final) => {
    for (const { res, id } of subscribers.get(key(task.tenant, task.id)) ?? []) {
      res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id, result: { statusUpdate: { taskId: task.id, contextId: task.contextId, status: taskJson(task).status, final } } })}\n\n`);
      if (final) res.end();
    }
    if (final) subscribers.delete(key(task.tenant, task.id));
  };
  const setState = (task, state, text, at) => {
    task.state = stateName(state);
    task.updatedAt = at ?? now();
    task.statusMessage = text ? agentMessage(task, text) : undefined;
    if (task.statusMessage) task.history.push(task.statusMessage);
    emit(task, TERMINAL.includes(task.state));
  };
  const newTask = (fields) => {
    const task = { id: fields.id ?? `scenario-task-${++counter}`, contextId: fields.contextId ?? `scenario-context-${counter}`, tenant: fields.tenant ?? "",
      state: stateName(fields.state ?? "working"), title: fields.title, updatedAt: fields.updatedAt ?? now(), history: fields.history ?? [], artifacts: fields.artifacts ?? [], statusMessage: undefined };
    tasks.set(key(task.tenant, task.id), task);
    return task;
  };
  const find = (tenant, id) => {
    const task = tasks.get(key(tenant, id));
    if (!task) throw new RpcError("TaskNotFoundError");
    return task;
  };

  const card = () => {
    const tenants = config.tenants?.length ? config.tenants : [undefined];
    const extensions = config.requireExtension ? [{ uri: config.requireExtension, required: true }] : [];
    return {
      name: "Scenario fixture", description: "Controllable agent for protocol scenarios", version: "1.0.0",
      supportedInterfaces: tenants.map((tenant) => ({ url: `${origin}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0", ...(tenant ? { tenant } : {}) })),
      capabilities: { streaming: true, pushNotifications: true, extendedAgentCard: Boolean(config.extendedCard), extensions },
      defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain"],
      skills: [{ id: "work", name: "Do work", description: "Runs a scenario task", tags: ["scenario"], examples: ["start a task"] }],
    };
  };

  const methods = {
    SendMessage(params) {
      const message = params.message ?? {};
      const tenant = params.tenant ?? "";
      if (message.taskId) {
        const task = find(tenant, message.taskId);
        if (TERMINAL.includes(task.state)) throw new RpcError("UnsupportedOperationError", "The task is finished");
        if (task.state === "TASK_STATE_WORKING" && config.rejectInputWhileWorking) throw new RpcError("UnsupportedOperationError", "Input is not accepted while working");
        if (task.state === "TASK_STATE_WORKING" && config.ignoreInputWhileWorking) return { task: taskJson(task) };
        task.history.push(message);
        if (task.state === "TASK_STATE_INPUT_REQUIRED") setState(task, "completed", "Thanks, that answers it.");
        else setState(task, "working", "Got it, continuing with the new input.");
        return { task: taskJson(task) };
      }
      const task = newTask({ tenant, contextId: message.contextId || undefined, history: [message], state: "working" });
      setState(task, "working");
      return { task: taskJson(task) };
    },
    GetTask(params) { return taskJson(find(params.tenant ?? "", params.id), params.historyLength); },
    ListTasks(params) {
      if (config.noList) throw Object.assign(new Error("Method not found"), { code: -32601, plain: true });
      const tenant = params.tenant ?? "";
      const after = params.statusTimestampAfter ? Date.parse(params.statusTimestampAfter) : 0;
      const wanted = params.status && !String(params.status).endsWith("UNSPECIFIED") ? stateName(params.status) : undefined;
      const rows = [...tasks.values()].filter((task) => task.tenant === tenant && (!params.contextId || task.contextId === params.contextId)
        && (!wanted || task.state === wanted) && Date.parse(task.updatedAt) >= after).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
      const size = Math.min(Math.max(Number(params.pageSize) || 50, 1), 100);
      const offset = Number(params.pageToken || 0);
      const page = rows.slice(offset, offset + size);
      return { tasks: page.map((task) => taskJson(task, params.historyLength)), nextPageToken: offset + size < rows.length ? String(offset + size) : "", pageSize: size, totalSize: rows.length };
    },
    CancelTask(params) {
      const task = find(params.tenant ?? "", params.id);
      if (TERMINAL.includes(task.state)) throw new RpcError("TaskNotCancelableError");
      setState(task, "canceled");
      return taskJson(task);
    },
    CreateTaskPushNotificationConfig(params) {
      find(params.tenant ?? "", params.taskId);
      const entry = { ...params, id: params.id || `push-${++counter}` };
      pushConfigs.set(`${params.taskId}\u0000${entry.id}`, entry);
      return entry;
    },
    GetTaskPushNotificationConfig(params) {
      const entry = pushConfigs.get(`${params.taskId}\u0000${params.id}`);
      if (!entry) throw new RpcError("TaskNotFoundError", "Push configuration not found");
      return entry;
    },
    ListTaskPushNotificationConfigs(params) { return { configs: [...pushConfigs.values()].filter((entry) => entry.taskId === params.taskId), nextPageToken: "" }; },
    DeleteTaskPushNotificationConfig(params) { pushConfigs.delete(`${params.taskId}\u0000${params.id}`); return {}; },
    GetExtendedAgentCard() {
      if (!config.extendedCard) throw new RpcError("ExtendedAgentCardNotConfiguredError");
      const base = card();
      return { ...base, skills: [...base.skills, ...(config.extendedCard.skills ?? [])] };
    },
  };

  const control = (body) => {
    if (body.reset) { tasks = new Map(); log = []; failures = []; config = { ...behaviors }; counter = 0; pushConfigs.clear(); return; }
    for (const entry of body.seed ?? []) newTask(entry);
    if (body.advance) setState(find(body.advance.tenant ?? "", body.advance.id), body.advance.state, body.advance.message);
    if (body.fail) {
      if (body.fail.error !== "drop" && !ERRORS[body.fail.error]) throw new Error(`Unknown error name ${body.fail.error}`);
      failures.push({ ...body.fail });
    }
    for (const name of ["requireExtension", "extendedCard", "ignoreInputWhileWorking", "rejectInputWhileWorking", "noList", "tenants"]) if (name in body) config[name] = body[name];
  };

  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://x").pathname;
    const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "");
    let input = "";
    for await (const chunk of request) input += chunk;
    const json = (status, body) => { response.statusCode = status; response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(body)); };
    if (path.startsWith("/__")) {
      if (!loopback) return json(403, { error: "Control endpoints are loopback only." });
      if (path === "/__state" && request.method === "GET") return json(200, { tasks: [...tasks.values()], log, config, pushConfigs: [...pushConfigs.values()] });
      if (path === "/__control" && request.method === "POST") {
        try { control(JSON.parse(input || "{}")); return json(200, { ok: true }); } catch (error) { return json(400, { error: error.message }); }
      }
      return json(404, { error: "Unknown control endpoint." });
    }
    if (request.method === "GET" && (path === "/card.json" || path === "/.well-known/agent-card.json")) return json(200, card());
    if (request.method !== "POST" || path !== "/a2a") return json(404, { error: "Not found" });
    let rpc;
    try { rpc = JSON.parse(input); } catch { return json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
    log.push({ method: rpc.method, params: rpc.params, at: now() });
    const failure = failures.find((item) => item.method === rpc.method && (item.times === undefined || item.times > 0));
    if (failure) {
      if (failure.times !== undefined) failure.times -= 1;
      if (failure.error === "drop") { request.socket.destroy(); return; }
      const [code, message] = ERRORS[failure.error];
      return json(200, { jsonrpc: "2.0", id: rpc.id, error: { code, message } });
    }
    try {
      if (rpc.method === "SubscribeToTask") {
        const task = find(rpc.params?.tenant ?? "", rpc.params?.id);
        if (TERMINAL.includes(task.state)) throw new RpcError("UnsupportedOperationError", "The task is finished");
        response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
        response.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { task: taskJson(task) } })}\n\n`);
        const list = subscribers.get(key(task.tenant, task.id)) ?? new Set();
        const subscriber = { res: response, id: rpc.id };
        list.add(subscriber); subscribers.set(key(task.tenant, task.id), list);
        response.on("close", () => list.delete(subscriber));
        return;
      }
      const handler = methods[rpc.method];
      if (!handler) return json(200, { jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: `Method not found: ${rpc.method}` } });
      return json(200, { jsonrpc: "2.0", id: rpc.id, result: handler(rpc.params ?? {}) });
    } catch (error) {
      if (error.plain) return json(200, { jsonrpc: "2.0", id: rpc.id, error: { code: error.code, message: error.message } });
      if (error instanceof RpcError) return json(200, { jsonrpc: "2.0", id: rpc.id, error: { code: error.code, message: error.message } });
      return json(200, { jsonrpc: "2.0", id: rpc.id, error: { code: -32603, message: "Internal error" } });
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => (await fetch(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  return {
    origin, url: `${origin}/a2a`, cardUrl: `${origin}/card.json`,
    control: (body) => post("/__control", body),
    state: async () => (await fetch(`${origin}/__state`)).json(),
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const agent = await startScenarioAgent({ port: Number(process.argv[2] ?? 4012) });
  console.log(agent.cardUrl);
}
