import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { readJsonRequest } from "@/lib/request-guard";
import { markRead, markReadSchema } from "@/server/runtime/notifications";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read marks are the member's own: they can never mark, or learn about, anyone else's notifications. */
async function handlePOST(request: Request) {
  try {
    const parsed = markReadSchema.safeParse(await readJsonRequest(request));
    if (!parsed.success) return Response.json({ error: { message: parsed.error.issues.map((issue) => issue.message).join("; ") } }, { status: 400 });
    return Response.json({ updated: await markRead(parsed.data) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 400); }
}

export const POST = authenticatedRoute("read", handlePOST);
