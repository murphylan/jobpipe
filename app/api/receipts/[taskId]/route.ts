import { dataRoot } from "../../../../lib/data-root.ts";
import { isSafeTaskId } from "../../../../lib/engine/envelope.ts";
import { readReceipt } from "../../../../lib/engine/receipt.ts";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, context: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await context.params;
  if (!isSafeTaskId(taskId)) return Response.json({ error: "invalid-taskId" }, { status: 400 });
  try {
    const receipt = readReceipt(dataRoot(), taskId);
    return Response.json({ receipt }, { status: receipt ? 200 : 404, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "receipt-corrupt" }, { status: 503 }); }
}
