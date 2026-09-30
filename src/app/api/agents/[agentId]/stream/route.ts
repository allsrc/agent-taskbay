import { agentRegistry } from "@/lib/agent-registry";
import { serializeStreamEvent, streamOperation } from "@/lib/gateway";
import { readJsonRequest } from "@/lib/request-guard";
import { extractSidebandEvents } from "@/server/sideband/decoder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SendBody {
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
  if (!body.resubscribe && !body.text?.trim() && !body.parts?.length) {
    return Response.json({ error: { message: "A message needs at least one content part." } }, { status: 400 });
  }
  if (body.resubscribe && !body.taskId) {
    return Response.json({ error: { message: "taskId is required to resubscribe." } }, { status: 400 });
  }

  const sessionId = crypto.randomUUID();
  const requestId = crypto.randomUUID();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const session = await streamOperation({
          connection: { cardUrl: agent.cardUrl, auth: { type: "none" }, headers: {} },
          // Any action other than "send" resubscribes to the existing task's
          // stream instead of sending a new message (see gateway.ts's streamOperation).
          action: body.resubscribe ? "getTask" : "send",
          params: {
            text: body.text,
            parts: body.parts,
            taskId: body.taskId,
            contextId: body.contextId,
            returnImmediately: body.config?.returnImmediately,
            historyLength: typeof body.config?.historyLength === "number" ? body.config.historyLength : undefined,
            acceptedOutputModes: body.config?.acceptedOutputModes?.length ? body.config.acceptedOutputModes : undefined,
            referenceTaskIds: body.config?.referenceTaskIds,
            extensions: body.config?.extensions,
            metadata: body.config?.metadata,
            requestMetadata: body.config?.requestMetadata,
          },
          sessionId,
          requestId,
        });
        controller.enqueue(frame("meta", {
          sessionId,
          requestId,
          protocolVersion: session.client.protocolVersion,
          transport: session.client.transport.protocolName,
          negotiatedExtensions: session.negotiatedExtensions,
        }));
        for await (const event of session.events) {
          const serialized = serializeStreamEvent(event);
          controller.enqueue(frame("a2a", serialized));
          const sidebandEvents = extractSidebandEvents(serialized, { sessionId, requestId, negotiatedExtensions: session.negotiatedExtensions });
          for (const sidebandEvent of sidebandEvents) controller.enqueue(frame("sideband", sidebandEvent));
        }
        controller.enqueue(frame("end", { sessionId, requestId }));
      } catch (error) {
        controller.enqueue(frame("error", { sessionId, requestId, message: error instanceof Error ? error.message : "Streaming request failed." }));
      } finally {
        controller.close();
      }
    },
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
