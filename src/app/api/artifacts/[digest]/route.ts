import { artifactStore, withTaskQueries } from "@/server/runtime/task-persistence";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ digest: string }> }) {
  const { digest } = await context.params;
  if (!/^[0-9a-f]{64}$/.test(digest)) return new Response("Not found", { status: 404 });
  const bytes = await withTaskQueries((_queries, organizationId) => artifactStore.get(organizationId, digest));
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": "application/octet-stream", "Content-Disposition": 'attachment; filename="artifact"',
    "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Content-Length": String(bytes.byteLength),
  } });
}
