import { z } from "zod";
import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { readJsonRequest } from "@/lib/request-guard";
import { MAX_HISTORY_LENGTH, refreshTaskHistory } from "@/server/runtime/task-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.object({ historyLength: z.number().int().min(1).max(MAX_HISTORY_LENGTH).optional() }).strict();

async function handlePOST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const parsed = body.safeParse(await readJsonRequest(request));
    if (!parsed.success) return Response.json({ error: { message: parsed.error.issues.map((issue) => issue.message).join("; "), kind: "invalid_request" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const result = await refreshTaskHistory((await context.params).taskId, parsed.data);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 502); }
}

export const POST = authenticatedRoute("operate", handlePOST);
