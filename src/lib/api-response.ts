import { NextResponse } from "next/server";

export function apiError(error: unknown, status = 502) {
  const message = error instanceof Error ? error.message : "Unexpected gateway error.";
  const name = error instanceof Error ? error.name : "Error";
  const knownStatus = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
  const kind = error && typeof error === "object" && "kind" in error && typeof error.kind === "string" ? error.kind : undefined;
  const details = error && typeof error === "object" && "details" in error && error.details && typeof error.details === "object" ? error.details : undefined;
  return NextResponse.json({ error: { name, message, ...(kind ? { kind } : {}), ...(details ? { details } : {}) } }, {
    status: knownStatus ?? status,
    headers: { "Cache-Control": "no-store", ...((knownStatus ?? status) === 429 ? { "Retry-After": "60" } : {}) },
  });
}
