import { authenticatedRoute } from "@/server/runtime/identity";
import { conditionalJson } from "@/lib/conditional-json";
import { apiError } from "@/lib/api-response";
import { inboxQuerySchema, listInbox } from "@/server/runtime/notifications";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
  try {
    const parsed = inboxQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return Response.json({ error: { message: parsed.error.issues.map((issue) => issue.message).join("; ") } }, { status: 400 });
    return conditionalJson(request, await listInbox({ unreadOnly: parsed.data.unread === "true", limit: parsed.data.limit, cursor: parsed.data.cursor }));
  } catch (error) { return apiError(error, 400); }
}

export const GET = authenticatedRoute("read", handleGET);
