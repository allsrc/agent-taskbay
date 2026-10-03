import { authenticatedRoute } from "@/server/runtime/identity";
import { agentRegistry } from "@/lib/agent-registry";
import { readJsonRequest } from "@/lib/request-guard";
import { acceptCommand, waitForCommand, compatibilityCommandKey } from "@/server/runtime/commands";
import { apiError } from "@/lib/api-response";
import { ensureTaskSubscription, readTaskFeed } from "@/server/runtime/subscriptions";
import { observationPaused } from "@/server/application/services/subscription-state";
import { object } from "@/server/application/services/task-projection";
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

/** Compatibility event view over committed state; workers own all remote streams. */
async function handlePOST(request: Request, context: { params: Promise<{ agentId: string }> }) {
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
  let localId: string | undefined;
  if (body.resubscribe) {
    try { localId = await ensureTaskSubscription(agent.id, body.tenant ?? "", body.taskId!); }
    catch (error) { return apiError(error, 400); }
  } else {
    try {
      const input = { ...body };
      delete input.resubscribe;
      const command = await acceptCommand(agent.id, input, request.headers.get("Idempotency-Key") ?? compatibilityCommandKey(agent.id, body.tenant, body.messageId));
      commandId = command.id;
    } catch (error) { return apiError(error, 400); }
  }

  let disconnected = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: string, data: unknown) => { if (!disconnected) controller.enqueue(frame(event, data)); };
      try {
        if (commandId) {
          emit("accepted", { commandId });
          const command = await waitForCommand(commandId, request.signal);
          localId = (command.resultJson as { localId: string }).localId;
        }
        let cursor = 0;
        let version = -1;
        const deadline = Date.now() + 50_000;
        while (!disconnected && !request.signal.aborted && Date.now() < deadline) {
          const { task, view, events, subscription } = await readTaskFeed(localId!, cursor);
          emit("persisted", { localId: task.id, taskId: task.remoteTaskId ?? task.id, tenant: task.tenant });
          if (version !== task.version) { emit("snapshot", view); version = task.version; }
          for (const event of events) {
            cursor = event.sequence!;
            const envelope = object(event.payloadJson);
            const value = envelope.originalEventObjectKey || envelope.streamMetadata ? envelope.event : event.payloadJson;
            const metadata = object(envelope.streamMetadata);
            if (envelope.streamMetadata) emit("meta", { ...metadata, sessionId: event.sessionId, requestId: event.requestId });
            emit("a2a", value);
            for (const sideband of extractSidebandEvents(value, { sessionId, requestId,
              negotiatedExtensions: Array.isArray(metadata.negotiatedExtensions) ? metadata.negotiatedExtensions as string[] : [] })) emit("sideband", sideband);
          }
          // Drain every committed event before ending a paused/terminal view.
          if (events.length === 100) continue;
          if (observationPaused(task.state)) break;
          if (subscription?.status === "stopped" && subscription.lastError) {
            emit("error", { sessionId, requestId, message: subscription.lastError }); break;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        emit("end", { sessionId, requestId });
      } catch {
        emit("error", { sessionId, requestId, commandId, message: "Durable task stream unavailable; query task or command status before retrying." });
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

export const POST = authenticatedRoute("operate", handlePOST);
