import { agentRegistry } from "@/lib/agent-registry";
import { serializeStreamEvent, streamOperation } from "@/lib/gateway";
import { readJsonRequest } from "@/lib/request-guard";
import { createTaskObserver } from "@/server/runtime/task-persistence";
import type { JsonValue } from "@/server/domain/persistence-model";
import { acceptCommand, waitForCommand, compatibilityCommandKey } from "@/server/runtime/commands";
import { apiError } from "@/lib/api-response";
import { extractSidebandEvents } from "@/server/sideband/decoder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SendBody {
  tenant?: string;
  messageId?: string;
  text?: string;
  parts?: unknown[];
  taskId?: string;
  contextId?: string;
  /** Execution preferences: `SendMessageConfiguration` plus message/request metadata. */
  config?: {
    returnImmediately?: boolean;
    historyLength?: number;
    acceptedOutputModes?: string[];
    referenceTaskIds?: string[];
    extensions?: string[];
    metadata?: Record<string, unknown>;
    requestMetadata?: Record<string, unknown>;
  };
  /** Reconnect to an in-flight task's stream (A2A spec §3.1.6, `tasks/resubscribe`) instead of sending a new message. */
  resubscribe?: boolean;
}

const encoder = new TextEncoder();
const frame = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/** `message/stream` (design doc §1/§7.2.6), proxied so agent credentials never reach the browser. */
export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await context.params;
  const agent = await agentRegistry().get(agentId);
  if (!agent) return Response.json({ error: { message: "Unknown agent." } }, { status: 404 });

  let body: SendBody;
  try { body = await readJsonRequest<SendBody>(request); }
  catch (error) { return Response.json({ error: { message: error instanceof Error ? error.message : "Invalid request JSON." } }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body) || (body.resubscribe !== undefined && typeof body.resubscribe !== "boolean")) {
    return Response.json({ error: { message: "A valid send or subscription object is required." } }, { status: 400 });
  }
  if (body.resubscribe && (typeof body.taskId !== "string" || !body.taskId || (body.tenant !== undefined && (typeof body.tenant !== "string" || body.tenant.length > 255)))) {
    return Response.json({ error: { message: "taskId is required to resubscribe." } }, { status: 400 });
  }

  const sessionId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  let commandId: string | undefined;
  if (!body.resubscribe) {
    try {
      const input = { ...body };
      delete input.resubscribe;
      const command = await acceptCommand(agent.id, input, request.headers.get("Idempotency-Key") ?? compatibilityCommandKey(agent.id, body.tenant, body.messageId));
      commandId = command.id;
    } catch (error) { return apiError(error, 400); }
  }
  const observer = createTaskObserver({ agentId: agent.id, tenant: body.tenant, sessionId, requestId });

  let disconnected = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: string, data: unknown) => { if (!disconnected) controller.enqueue(frame(event, data)); };
      try {
        let taskId = body.taskId;
        if (commandId) {
          emit("accepted", { commandId });
          const command = await waitForCommand(commandId, request.signal);
          const result = command.resultJson as { event: JsonValue; localId: string; taskId: string; tenant: string };
          emit("persisted", { localId: result.localId, taskId: result.taskId, tenant: result.tenant });
          emit("a2a", result.event);
          const task = (result.event as { task?: { id: string; status?: { state: string } } }).task;
          if (!task || ["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED", "TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED"].includes(task.status?.state ?? "")) {
            emit("end", { sessionId, requestId, commandId });
            return;
          }
          taskId = task.id;
        }
        // Initial sends are worker-dispatched. Only the follow-up subscription
        // remains attached to this browser request until Slice 2.2.
        const session = await streamOperation({
          connection: { cardUrl: agent.cardUrl, auth: { type: "none" }, headers: {} },
          action: "getTask", params: { tenant: body.tenant, taskId }, sessionId, requestId,
        });
        emit("meta", {
          sessionId,
          requestId,
          protocolVersion: session.client.protocolVersion,
          transport: session.client.transport.protocolName,
          negotiatedExtensions: session.negotiatedExtensions,
        });
        for await (const event of session.events) {
          if (disconnected || request.signal.aborted) break;
          const serialized = serializeStreamEvent(event);
          const durable = await observer(serialized as JsonValue);
          emit("persisted", { localId: durable.localId, taskId: durable.taskId, tenant: durable.tenant });
          emit("a2a", serialized);
          const sidebandEvents = extractSidebandEvents(serialized, { sessionId, requestId, negotiatedExtensions: session.negotiatedExtensions });
          for (const sidebandEvent of sidebandEvents) emit("sideband", sidebandEvent);
        }
        emit("end", { sessionId, requestId });
      } catch (error) {
        emit("error", { sessionId, requestId, commandId, message: error instanceof Error ? error.message : "Streaming request failed." });
      } finally {
        if (!disconnected) controller.close();
      }
    },
    cancel() { disconnected = true; },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
