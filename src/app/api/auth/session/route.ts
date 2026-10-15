import { authenticatedRoute } from "@/server/runtime/identity";
import { currentPrincipal } from "@/server/adapters/auth/principal-context";
import { loadAuthConfig } from "@/server/adapters/auth/config";
import { taskDiscoveryCap } from "@/server/runtime/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = authenticatedRoute("read", async () => {
  const principal = currentPrincipal()!;
  return Response.json({ user: { displayName: principal.displayName, role: principal.role },
    mode: loadAuthConfig().mode, taskDiscoveryCap: taskDiscoveryCap() }, { headers: { "Cache-Control": "no-store" } });
});
