import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { listEligibleReviewers } from "@/server/runtime/decisions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
  try {
    const reviewers = await listEligibleReviewers(new URL(request.url).searchParams.get("taskId") ?? "");
    return reviewers ? Response.json({ reviewers }, { headers: { "Cache-Control": "no-store" } }) :
      Response.json({ error: { message: "Task not found." } }, { status: 404, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 400); }
}

export const GET = authenticatedRoute("operate", handleGET);
