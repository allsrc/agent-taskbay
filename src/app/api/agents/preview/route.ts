import { authenticatedRoute } from "@/server/runtime/identity";
import { NextResponse } from "next/server";
import { discoverAgent } from "@/lib/gateway";
import { apiError } from "@/lib/api-response";
import { readJsonRequest } from "@/lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fetches and validates an Agent Card without registering it (step 1 of "Connect agent"). SSRF checks live in the gateway. */
async function handlePOST(request: Request) {
  try {
    const body = await readJsonRequest<{ cardUrl?: string }>(request);
    if (!body.cardUrl?.trim()) throw new Error("cardUrl is required.");
    const discovery = await discoverAgent({ cardUrl: body.cardUrl.trim(), auth: { type: "none" }, headers: {} });
    return NextResponse.json(
      { card: discovery.card, resolvedCardUrl: discovery.resolvedCardUrl, report: discovery.report },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error, 400);
  }
}

export const POST = authenticatedRoute("administer", handlePOST);
