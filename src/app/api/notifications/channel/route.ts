import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { channelStatus } from "@/server/runtime/notifications";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET() {
  try { return Response.json(await channelStatus(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return apiError(error, 400); }
}

export const GET = authenticatedRoute("administer", handleGET);
