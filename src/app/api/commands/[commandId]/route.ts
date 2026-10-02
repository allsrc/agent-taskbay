import { apiError } from "@/lib/api-response";
import { commandView, readCommand } from "@/server/runtime/commands";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ commandId: string }> }) {
  try {
    const command = await readCommand((await context.params).commandId);
    return command ? Response.json({ command: commandView(command) }, { headers: { "Cache-Control": "no-store" } }) :
      Response.json({ error: { message: "Command not found." } }, { status: 404 });
  } catch (error) { return apiError(error, 500); }
}
