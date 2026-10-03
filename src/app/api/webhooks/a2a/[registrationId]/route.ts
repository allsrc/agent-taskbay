import { publicSecurityRateLimit } from "@/server/runtime/security";
import { RateLimitError } from "@/server/adapters/db/security-repository";
import { receivePush } from "@/server/runtime/push";
import { PushReceiptError } from "@/server/application/ports/push";
import { RequestValidationError } from "@/lib/request-guard";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ registrationId: string }> }) {
  try {
    await publicSecurityRateLimit("webhook");
    const { registrationId } = await context.params;
    await receivePush(registrationId, request);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const expected = error instanceof PushReceiptError || error instanceof RequestValidationError || error instanceof RateLimitError;
    const status = expected ? error.status : 503;
    return Response.json({ error: expected ? error.message : "Push receipt unavailable; retry later." }, {
      status, headers: { "Cache-Control": "no-store", ...(status === 429 ? { "Retry-After": "60" } : {}) },
    });
  }
}
