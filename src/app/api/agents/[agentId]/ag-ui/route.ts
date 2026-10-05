import { createHash } from "node:crypto";
import { authenticatedRoute } from "@/server/runtime/identity";
import { agentRegistry } from "@/lib/agent-registry";
import { readJsonRequest } from "@/lib/request-guard";
import { apiError } from "@/lib/api-response";
import { acceptCommand, waitForCommand } from "@/server/runtime/commands";
import { readTaskFeed } from "@/server/runtime/subscriptions";
import { withTaskQueries } from "@/server/runtime/task-persistence";
import { advertisedExtensionUris } from "@/server/runtime/agent-extensions";
import { observationPaused } from "@/server/application/services/subscription-state";
import { answerParts, planRun, type RunPlan } from "@/server/adapters/agui/run-input";
import { RunTranslator, type AgUiEvent } from "@/server/adapters/agui/translator";
import { stateName } from "@/lib/task-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const encoder = new TextEncoder();
/** AG-UI HTTP+SSE framing: each `data:` payload is exactly one event object. */
const frame = (event: AgUiEvent) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
const asking = (state: string) => ["INPUT_REQUIRED", "AUTH_REQUIRED"].includes(stateName(state));

/** ADR 0021: one AG-UI run is one durable A2A command; events are translated from committed task state. */
async function handlePOST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  if (process.env.A2A_AGUI_ENABLED !== "true") return Response.json({ error: { message: "The AG-UI adapter is not enabled." } }, { status: 404 });
  const { agentId } = await context.params;
  const agent = await agentRegistry().get(agentId);
  if (!agent) return Response.json({ error: { message: "Unknown agent." } }, { status: 404 });

  let plan: RunPlan;
  try { plan = planRun(await readJsonRequest<unknown>(request)); }
  catch (error) { return Response.json({ error: { message: error instanceof Error ? error.message : "Invalid request." } }, { status: 400 }); }

  // Everything that can be refused is refused before the stream starts, as plain HTTP errors.
  let baseline: string[] = [];
  let localId: string | undefined;
  let input: Record<string, unknown>;
  if (plan.kind === "resume") {
    const view = await withTaskQueries((queries, organizationId) => queries.detail(organizationId, plan.localTaskId)).catch(() => undefined);
    if (!view || view.agentId !== agent.id || view.contextId !== plan.threadId) return Response.json({ error: { message: "Unknown interrupt." } }, { status: 404 });
    if (!asking(view.state)) return Response.json({ error: { message: "That interrupt is no longer open." } }, { status: 409 });
    localId = view.localId;
    baseline = view.messages.map((message) => message.id);
    try {
      input = plan.status === "abandoned"
        ? { action: "cancelTask", taskId: view.taskId, tenant: view.tenant }
        : { parts: answerParts(plan.payload), taskId: view.taskId, contextId: view.contextId, tenant: view.tenant, messageId: `ag-ui-${plan.runId}` };
    } catch (error) { return Response.json({ error: { message: error instanceof Error ? error.message : "Invalid resume payload." } }, { status: 400 }); }
  } else {
    input = { text: plan.text, messageId: plan.messageId, contextId: plan.threadId };
  }
  const key = `ag-ui:${createHash("sha256").update(JSON.stringify([agent.id, plan.threadId, plan.runId])).digest("hex")}`;
  let commandId: string;
  try { commandId = (await acceptCommand(agent.id, input, key)).id; }
  catch (error) { return apiError(error, 400); }

  const advertisedExtensions = await advertisedExtensionUris(agent.id).catch(() => []);
  const translator = new RunTranslator({ threadId: plan.threadId, runId: plan.runId }, baseline, { advertisedExtensions });
  let disconnected = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (events: AgUiEvent[]) => { if (!disconnected) for (const event of events) controller.enqueue(frame(event)); };
      emit(translator.start());
      try {
        const command = await waitForCommand(commandId, request.signal);
        localId ??= (command.resultJson as { localId?: string } | null)?.localId;
        if (!localId) throw new Error("The command produced no task.");
        const resuming = plan.kind === "resume";
        const deadline = Date.now() + 50_000;
        while (!disconnected && !request.signal.aborted && Date.now() < deadline) {
          const { view, subscription } = await readTaskFeed(localId, Number.MAX_SAFE_INTEGER);
          if (!view) throw new Error("The task is no longer available.");
          emit(translator.observe(view));
          // After a resume the task still shows the old question until the agent's reply lands; wait for something new.
          const moved = !resuming || !asking(view.state) || translator.agentMessagesSeen > baseline.length;
          if (observationPaused(view.state) && moved) { emit(translator.finish(view)); break; }
          if (subscription?.status === "stopped" && subscription.lastError) { emit(translator.error(subscription.lastError, "subscription_stopped")); break; }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!translator.done && !disconnected && !request.signal.aborted)
          emit(translator.error("The task is still running; it continues durably. Query it by id or start a new run.", "run_timeout"));
      } catch (error) {
        emit(translator.error(error instanceof Error && "status" in error ? error.message : "The durable task stream is unavailable; query the task before retrying.", "stream_unavailable"));
      } finally {
        if (!disconnected) controller.close();
      }
    },
    cancel() { disconnected = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}

export const POST = authenticatedRoute("operate", handlePOST);
