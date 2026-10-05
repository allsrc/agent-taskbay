import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { detailView, readDecision } from "@/server/runtime/decisions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(_request: Request, context: { params: Promise<{ decisionId: string }> }) {
  try {
    const detail = await readDecision((await context.params).decisionId);
    return detail ? Response.json(detailView(detail), { headers: { "Cache-Control": "no-store" } }) :
      Response.json({ error: { message: "Decision request not found." } }, { status: 404, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 400); }
}

export const GET = authenticatedRoute("read", handleGET);
