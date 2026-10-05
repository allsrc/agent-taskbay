import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { sendTestNotification } from "@/server/runtime/notifications";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST() {
  try { await sendTestNotification(); return Response.json({ queued: true }, { status: 202, headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return apiError(error, 400); }
}

export const POST = authenticatedRoute("administer", handlePOST);
