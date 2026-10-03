import { authorizedArtifact } from "@/server/runtime/security";
import { authenticatedRoute } from "@/server/runtime/identity";
import { artifactStore, withTaskQueries } from "@/server/runtime/task-persistence";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(_request: Request, context: { params: Promise<{ digest: string }> }) {
  const { digest } = await context.params;
  if (!/^[0-9a-f]{64}$/.test(digest)) return new Response("Not found", { status: 404 });
  const bytes = await withTaskQueries(async (_queries, organizationId) => await authorizedArtifact(organizationId, digest) ? artifactStore.get(organizationId, digest) : undefined);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": "application/octet-stream", "Content-Disposition": 'attachment; filename="artifact"',
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "no-store", "Content-Length": String(bytes.byteLength),
  } });
}

export const GET = authenticatedRoute("read", handleGET);
