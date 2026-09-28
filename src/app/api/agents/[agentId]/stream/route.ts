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

  const sessionId = crypto.randomUUID();
  const requestId = crypto.randomUUID();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const session = await streamOperation({
          connection: { cardUrl: agent.cardUrl, auth: { type: "none" }, headers: {} },
          action: "send",
          params: { text: body.text, parts: body.parts, taskId: body.taskId, contextId: body.contextId },
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
